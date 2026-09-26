"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import type { ExpectedItemOwner, ExpectedItemStatus } from "@/lib/types";

/**
 * Manual Ledger UI actions (Transaction Intelligence, Phase G Section 3).
 * Every mutation here is a human decision made right now — it writes
 * deal_expected_items directly (no approval queue needed, there's nothing
 * pending) and is attributed via a deal_updates row with status 'approved'
 * so it shows up in the deal's approved-activity trail alongside AI-approved
 * changes, per your "attributed via deal_updates" instruction.
 */

export type LedgerActionState = { ok: true } | { ok: false; error: string };

const STATUS_ORDER: ExpectedItemStatus[] = ["expected", "requested", "received", "cleared", "waived"];

async function logActivity(dealId: string, note: string) {
  const supabase = await createClient();
  const user = await getSessionUser();
  await supabase.from("deal_activity").insert({
    deal_id: dealId,
    action: "ledger_change",
    note,
    created_by: user?.id ?? null,
  });
}

/** Record a manual ledger action in deal_updates — already resolved, attributing who did what. */
async function recordManualLedgerChange(dealId: string, summary: string) {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return;
  const now = new Date().toISOString();
  await supabase.from("deal_updates").insert({
    deal_id: dealId,
    source: "note",
    author_id: user.id,
    event_type: "other",
    summary,
    status: "approved",
    reviewed_by: user.id,
    reviewed_at: now,
  });
}

/** Add a new deal-specific ledger item manually. */
export async function addLedgerItem(
  dealId: string,
  label: string,
  ownerParty: ExpectedItemOwner,
): Promise<LedgerActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: "Label can't be empty." };

  const supabase = await createClient();
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const itemKey = slug || `item_${Date.now()}`;

  const { error } = await supabase.from("deal_expected_items").insert({
    deal_id: dealId,
    item_key: itemKey,
    label: trimmed,
    owner_party: ownerParty,
    status: "expected",
    source: "manual",
  });
  if (error) return { ok: false, error: error.code === "23505" ? "An item with that name already exists on this deal." : error.message };

  await recordManualLedgerChange(dealId, `Added ledger item "${trimmed}"`);
  await logActivity(dealId, `Ledger: added "${trimmed}"`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Advance a ledger item to the next status in sequence (expected → requested → received → cleared). Stops short of 'waived' — that's a separate, explicit action. */
export async function advanceLedgerItem(itemId: string): Promise<LedgerActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();

  const { data: item, error: fetchError } = await supabase
    .from("deal_expected_items")
    .select("id, deal_id, label, status")
    .eq("id", itemId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!item) return { ok: false, error: "Item not found." };

  const idx = STATUS_ORDER.indexOf(item.status as ExpectedItemStatus);
  if (idx === -1 || idx >= STATUS_ORDER.length - 2) {
    return { ok: false, error: "Already at the last advanceable status." };
  }
  const next = STATUS_ORDER[idx + 1];
  const now = new Date().toISOString();
  const patch: Record<string, string> = { status: next };
  if (next === "requested") patch.requested_at = now;
  if (next === "received") patch.received_at = now;
  if (next === "cleared") patch.cleared_at = now;

  const { error } = await supabase.from("deal_expected_items").update(patch).eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  await recordManualLedgerChange(item.deal_id, `${item.label} → ${next}`);
  await logActivity(item.deal_id, `Ledger: ${item.label} advanced to ${next}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Revert a ledger item to the previous status in sequence (or 'expected' when reverting off 'waived'). */
export async function revertLedgerItem(itemId: string): Promise<LedgerActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();

  const { data: item, error: fetchError } = await supabase
    .from("deal_expected_items")
    .select("id, deal_id, label, status")
    .eq("id", itemId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!item) return { ok: false, error: "Item not found." };

  const status = item.status as ExpectedItemStatus;
  const idx = STATUS_ORDER.indexOf(status);
  if (status !== "waived" && idx <= 0) return { ok: false, error: "Already at the first status." };
  const prev: ExpectedItemStatus = status === "waived" ? "expected" : STATUS_ORDER[idx - 1];

  const patch: Record<string, string | null> = { status: prev };
  if (prev === "expected") {
    patch.requested_at = null;
    patch.received_at = null;
    patch.cleared_at = null;
  } else if (prev === "requested") {
    patch.received_at = null;
    patch.cleared_at = null;
  } else if (prev === "received") {
    patch.cleared_at = null;
  }

  const { error } = await supabase.from("deal_expected_items").update(patch).eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  await recordManualLedgerChange(item.deal_id, `${item.label} reverted → ${prev}`);
  await logActivity(item.deal_id, `Ledger: ${item.label} reverted to ${prev}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Waive a ledger item — this deal doesn't need it. */
export async function waiveLedgerItem(itemId: string): Promise<LedgerActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();

  const { data: item, error: fetchError } = await supabase
    .from("deal_expected_items")
    .select("id, deal_id, label, status")
    .eq("id", itemId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!item) return { ok: false, error: "Item not found." };
  if (item.status === "waived") return { ok: false, error: "Already waived." };

  const { error } = await supabase.from("deal_expected_items").update({ status: "waived" }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  await recordManualLedgerChange(item.deal_id, `${item.label} waived`);
  await logActivity(item.deal_id, `Ledger: ${item.label} waived`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
