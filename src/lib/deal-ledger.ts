import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpectedItemOwner, ExpectedItemStatus, UnderwritingOutput } from "@/lib/types";
import { money } from "@/lib/format";
import { sendPofRequiredAlert } from "@/lib/email";

/**
 * Transaction Intelligence — expected-item ledger templates + idempotent
 * backfill (Phase G, Section 1c). Seeds deal_expected_items for every active
 * escrow deal so the Ledger UI (Section 3) and digest OUTSTANDING table
 * (Section 4) always have a baseline row set, even before any mail has been
 * scanned. Backfill is upsert-on-conflict-do-nothing — it never touches a row
 * that already exists, so manual status advances (or ones made by the Gmail
 * scans) are never clobbered by a later run.
 */

export interface ExpectedItemTemplate {
  item_key: string;
  label: string;
  owner_party: ExpectedItemOwner;
}

/** Residential baseline — every escrow deal gets these seven. */
export const BASE_EXPECTED_ITEMS: ExpectedItemTemplate[] = [
  { item_key: "title_commitment", label: "Title Commitment", owner_party: "title" },
  { item_key: "survey", label: "Survey", owner_party: "title" },
  { item_key: "emd_receipt", label: "EMD Receipt", owner_party: "internal" },
  { item_key: "insurance_policy", label: "Insurance Policy", owner_party: "internal" },
  { item_key: "appraisal_report", label: "Appraisal Report", owner_party: "lender" },
  { item_key: "pof_submission", label: "Proof of Funds Submission", owner_party: "internal" },
  { item_key: "clear_to_close", label: "Clear to Close", owner_party: "lender" },
];

/** Commercial deals add these on top of the residential baseline. */
export const COMMERCIAL_EXPECTED_ITEMS: ExpectedItemTemplate[] = [
  { item_key: "rent_roll", label: "Rent Roll", owner_party: "seller" },
  { item_key: "t12", label: "T-12 (Trailing 12-Month Operating Statement)", owner_party: "seller" },
];

/**
 * Asset class from the deal's stored underwriting output. Mirrors the exact
 * check already used to seed lender_readiness_docs (migration
 * 20260617000002_lending_escrow_backfill.sql): commercial only when
 * extracted_deal_data.property_type explicitly says so; residential is the
 * default for everything else (including deals with no ai_analysis at all).
 */
export function assetClassForDeal(aiAnalysis: UnderwritingOutput | null | undefined): "residential" | "commercial" {
  const propertyType = aiAnalysis?.extracted_deal_data?.property_type;
  return (propertyType ?? "").toLowerCase() === "commercial" ? "commercial" : "residential";
}

/** The full expected-item template for a deal's asset class. */
export function expectedItemsTemplateFor(assetClass: "residential" | "commercial"): ExpectedItemTemplate[] {
  return assetClass === "commercial" ? [...BASE_EXPECTED_ITEMS, ...COMMERCIAL_EXPECTED_ITEMS] : BASE_EXPECTED_ITEMS;
}

interface EscrowDealForBackfill {
  id: string;
  ai_analysis: UnderwritingOutput | null;
}

/**
 * Idempotent backfill: seed the template's items for every active escrow deal
 * (status = 'active' AND escrow_date set), skipping any (deal_id, item_key)
 * pair that already exists. Runs at the start of the nightly digest job
 * (Section 4) so every escrow deal always has a ledger before the digest
 * reads it, including deals that entered escrow before this feature shipped.
 */
export async function backfillExpectedItems(
  admin: SupabaseClient,
): Promise<{ dealsScanned: number; rowsUpserted: number }> {
  const { data: dealRows } = await admin
    .from("deals")
    .select("id, ai_analysis")
    .eq("status", "active")
    .not("escrow_date", "is", null);
  const deals = (dealRows ?? []) as EscrowDealForBackfill[];
  if (!deals.length) return { dealsScanned: 0, rowsUpserted: 0 };

  const rows: { deal_id: string; item_key: string; label: string; owner_party: ExpectedItemOwner; source: string }[] = [];
  for (const deal of deals) {
    const template = expectedItemsTemplateFor(assetClassForDeal(deal.ai_analysis));
    for (const item of template) {
      rows.push({
        deal_id: deal.id,
        item_key: item.item_key,
        label: item.label,
        owner_party: item.owner_party,
        source: "template",
      });
    }
  }

  const { error } = await admin
    .from("deal_expected_items")
    .upsert(rows, { onConflict: "deal_id,item_key", ignoreDuplicates: true });
  if (error) {
    console.error("backfillExpectedItems: upsert failed:", error.message);
    return { dealsScanned: deals.length, rowsUpserted: 0 };
  }

  return { dealsScanned: deals.length, rowsUpserted: rows.length };
}

// ---------------------------------------------------------------------------
// Ledger advancement (Phase G, Section 2c) — the Gmail scans call this to
// advance an existing item's status or create a new deal-specific one from an
// AI-detected signal (DetectedLedgerItem from underwriting.ts). Forward-only:
// a later low-confidence or repeat detection can never regress an item that's
// already 'received'/'cleared' back to 'requested', and 'waived' is reserved
// for a manual operator action — the AI never sets it.
// ---------------------------------------------------------------------------

const STATUS_PRECEDENCE: Record<ExpectedItemStatus, number> = {
  expected: 0,
  requested: 1,
  received: 2,
  cleared: 3,
  waived: 4,
};

/** AI-driven ledger item creation cap — one run's worth, per deal (Section 2c). */
export const MAX_AI_CREATED_ITEMS_PER_DEAL_PER_RUN = 5;

export interface AdvanceLedgerItemParams {
  dealId: string;
  itemKeyGuess: string;
  label: string;
  /** 'requested' | 'received' | 'cleared' — matches ExpectedItemStatus minus 'expected'/'waived'. */
  direction: "requested" | "received" | "cleared";
  counterparty: string | null;
  confidence: number;
  evidenceRef: string;
  /** 'ai_doc' for PDF-attachment detections, 'ai_email' for inbound-email detections. */
  source: "ai_doc" | "ai_email";
  /** Outbound mail may only match an EXISTING item (an ask isn't proof a new item is real) — never true for outbound callers. */
  allowCreate: boolean;
  /** Per-deal creation count for the calling route's run — caller owns the Map, mutated in place, enforces the cap above. */
  createdCount: Map<string, number>;
}

export interface LedgerAdvanceResult {
  itemKey: string;
  created: boolean;
  newStatus: ExpectedItemStatus;
}

/** Advance an existing ledger item's status, or create a new deal-specific one, from a single AI-detected signal. */
export async function advanceOrCreateLedgerItem(
  admin: SupabaseClient,
  params: AdvanceLedgerItemParams,
): Promise<LedgerAdvanceResult | null> {
  if (params.confidence < 0.6) return null; // never act on a low-confidence guess

  const { data: existing } = await admin
    .from("deal_expected_items")
    .select("id, status")
    .eq("deal_id", params.dealId)
    .eq("item_key", params.itemKeyGuess)
    .maybeSingle();

  const targetStatus = params.direction as ExpectedItemStatus;

  if (existing) {
    if (STATUS_PRECEDENCE[targetStatus] <= STATUS_PRECEDENCE[existing.status as ExpectedItemStatus]) {
      return null; // already at or past this status — don't regress
    }
    const patch: Record<string, string> = { status: targetStatus, evidence_ref: params.evidenceRef };
    if (targetStatus === "requested") patch.requested_at = new Date().toISOString();
    if (targetStatus === "received") patch.received_at = new Date().toISOString();
    if (targetStatus === "cleared") patch.cleared_at = new Date().toISOString();
    const { error } = await admin.from("deal_expected_items").update(patch).eq("id", existing.id);
    if (error) {
      console.error("advanceOrCreateLedgerItem: update failed:", error.message);
      return null;
    }
    return { itemKey: params.itemKeyGuess, created: false, newStatus: targetStatus };
  }

  if (!params.allowCreate) return null;
  const count = params.createdCount.get(params.dealId) ?? 0;
  if (count >= MAX_AI_CREATED_ITEMS_PER_DEAL_PER_RUN) return null;

  const ownerParty: ExpectedItemOwner = params.counterparty ? "other" : "internal";
  const { error } = await admin.from("deal_expected_items").insert({
    deal_id: params.dealId,
    item_key: params.itemKeyGuess,
    label: params.label,
    owner_party: ownerParty,
    status: targetStatus,
    source: params.source,
    evidence_ref: params.evidenceRef,
    requested_at: targetStatus === "requested" ? new Date().toISOString() : null,
    received_at: targetStatus === "received" ? new Date().toISOString() : null,
    cleared_at: targetStatus === "cleared" ? new Date().toISOString() : null,
  });
  if (error) {
    console.error("advanceOrCreateLedgerItem: insert failed:", error.message);
    return null;
  }
  params.createdCount.set(params.dealId, count + 1);
  return { itemKey: params.itemKeyGuess, created: true, newStatus: targetStatus };
}

// ---------------------------------------------------------------------------
// POF trigger (Phase G, Section 2d) — fires when a deal's appraised_value
// lands (auto-applied or approved). Dedupe is keyed off the pof_submission
// item's own evidence_ref ("appraised_value:<n>") rather than a new deals
// column — re-running with the SAME value is a no-op email-wise, but a
// CHANGED value (re-appraisal) re-fires with the new number.
// ---------------------------------------------------------------------------

export const POF_PCT = 0.32;

export interface PofDealInfo {
  id: string;
  property_address: string;
  entity_name: string | null;
  appraised_value: number;
}

/** Upsert the pof_submission ledger item and email the alert — but only once per distinct appraised_value. */
export async function maybeTriggerPof(
  admin: SupabaseClient,
  deal: PofDealInfo,
): Promise<{ fired: boolean; amount: number }> {
  const amount = Math.round(deal.appraised_value * POF_PCT);
  const marker = `appraised_value:${deal.appraised_value}`;
  const notes = `POF due: ${money(amount)} (32% of ${money(deal.appraised_value)} appraised)`;

  const { data: existing } = await admin
    .from("deal_expected_items")
    .select("id, status, evidence_ref")
    .eq("deal_id", deal.id)
    .eq("item_key", "pof_submission")
    .maybeSingle();

  const alreadyFiredForThisValue = existing?.evidence_ref === marker;

  if (existing) {
    const patch: Record<string, string> = { notes, evidence_ref: marker };
    if (STATUS_PRECEDENCE[existing.status as ExpectedItemStatus] <= STATUS_PRECEDENCE.expected) {
      patch.status = "requested";
      patch.requested_at = new Date().toISOString();
    }
    await admin.from("deal_expected_items").update(patch).eq("id", existing.id);
  } else {
    await admin.from("deal_expected_items").insert({
      deal_id: deal.id,
      item_key: "pof_submission",
      label: "Proof of Funds Submission",
      owner_party: "internal",
      status: "requested",
      notes,
      evidence_ref: marker,
      source: "system",
      requested_at: new Date().toISOString(),
    });
  }

  if (alreadyFiredForThisValue) return { fired: false, amount };

  await sendPofRequiredAlert({
    amount,
    appraisedValue: deal.appraised_value,
    propertyAddress: deal.property_address,
    entityName: deal.entity_name,
  });

  return { fired: true, amount };
}
