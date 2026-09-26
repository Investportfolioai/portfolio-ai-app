import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { searchDealCommunications } from "@/lib/gmail";
import { matchDeal, addressSearchPhrases, type MatchableDeal } from "@/lib/deal-match";
import { recordCommunication, recordWaitingOn, clearWaitingOn, recordAutoApply, recordPending, isEmpty } from "@/lib/deal-updates";
import { advanceOrCreateLedgerItem, maybeTriggerPof } from "@/lib/deal-ledger";
import { classifyOutboundEmail, classifyInboundEmail } from "@/lib/underwriting";
import type { ProposedChanges } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Bounds for one run — comms scanning is lighter than attachment extraction,
// but it shares /api/cron/daily's 60s budget with the attachment scan and the
// nightly digest. Kept conservative here; the shared cross-step budget is
// reconciled in section 6.
const MAX_COMM_MESSAGES_PER_RUN = 12;
const MAX_AI_CLASSIFY_PER_RUN = 8;
const MAX_INBOUND_CLASSIFY_PER_RUN = 8;
// Standalone fallback budget; inside /api/cron/daily the shared x-cron-deadline
// header takes precedence so scan → comms → digest fit the one 60s function.
const RUN_TIME_BUDGET_MS = 12_000;

// Cheap prefilter so the AI classifier only runs on emails that plausibly
// contain a request — avoids spending an AI call on every FYI/confirmation.
const REQUEST_HINTS = [
  "request", "please", "send", "extension", "extend", "payoff", "wire",
  "sign", "signature", "need", "addendum", "figures", "statement",
  "provide", "confirm", "document", "docs", "deadline",
];

// Prefilter for the INBOUND ledger-signal classifier (Transaction Intelligence,
// Section 2a) — broader than REQUEST_HINTS since a fact-bearing reply ("the
// appraisal came back at...", "entity for this deal is...", "wired the EMD
// this morning") rarely uses request-style language.
const LEDGER_SIGNAL_HINTS = [
  "appraisal", "appraised", "entity", "vesting", "llc", "wired", "wire sent",
  "deposit", "earnest money", "receipt", "rent roll", "t-12", "t12",
  "insurance", "policy", "survey", "title commitment", "clear to close",
  "attached", "enclosed", "completed", "received", "delivered",
];

function looksLikeRequest(subject: string, snippet: string): boolean {
  const t = `${subject} ${snippet}`.toLowerCase();
  return REQUEST_HINTS.some((k) => t.includes(k));
}

function looksLikeLedgerSignal(subject: string, snippet: string): boolean {
  const t = `${subject} ${snippet}`.toLowerCase();
  return LEDGER_SIGNAL_HINTS.some((k) => t.includes(k));
}

/** Human-ish counterparty label from a "Name <email>" header. */
function counterpartyFrom(header: string): string {
  const named = header.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named) return named[1].trim();
  const email = header.match(/[^\s<>]+@[^\s<>]+/);
  return email ? email[0] : header.trim() || "counterparty";
}

interface CommsDeal extends MatchableDeal {
  appraised_value: number | null;
  entity_name: string | null;
  emd_received_at: string | null;
}

/**
 * Section 5 — sent + inbound communication scan. Deal-matched OUTBOUND emails
 * become timeline 'communication' entries; an AI-detected outbound REQUEST also
 * creates a waiting-on marker (deal_updates status 'auto', event_type 'task')
 * and, per Transaction Intelligence Section 2c, may advance an EXISTING ledger
 * item to 'requested'. INBOUND mail clears any open waiting-on markers AND
 * (Section 2a/b/c) may extract deal facts (appraised value, vesting entity,
 * EMD receipt) and ledger signals from its body text.
 *
 * HARD RULE (still enforced structurally): sent mail can never write a deals
 * field, and its ledger reach stops at 'requested' on an item that already
 * exists — it can never create a new item or claim one was received/cleared.
 * Only inbound mail, a filed document (attachment scan), or an operator can
 * confirm a fact or advance a ledger item to 'received'/'cleared'.
 *
 * Separate dedupe ledger (gmail_processed_comms) so a message handled here
 * stays eligible for the attachment scan and vice-versa. CRON_SECRET-guarded;
 * folded into /api/cron/daily.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const headerDeadline = Number(req.headers.get("x-cron-deadline")) || 0;
  const budgetEnd = headerDeadline || Date.now() + RUN_TIME_BUDGET_MS;
  const timeLeft = () => Date.now() < budgetEnd;

  let communications = 0;
  let waitingOn = 0;
  let cleared = 0;
  let unmatched = 0;
  let outboundAiCalls = 0;
  let inboundAiCalls = 0;
  let autoApplied = 0;
  let timedOut = 0;

  // Per-deal cap on AI-created ledger items, shared across this whole run (Section 2c).
  const aiCreatedCounts = new Map<string, number>();

  const { data: dealRows } = await admin
    .from("deals")
    .select("id, property_address, appraised_value, entity_name, emd_received_at")
    .in("status", ["active", "pending"]);
  const deals = (dealRows ?? []) as CommsDeal[];
  const phrases = addressSearchPhrases(deals);
  if (!phrases.length) {
    return NextResponse.json({ ok: true, scanned: 0, reached: 0, communications, waitingOn, cleared, unmatched, outboundAiCalls, inboundAiCalls, autoApplied, timedOut });
  }

  const candidates = (await searchDealCommunications(phrases)).slice(0, MAX_COMM_MESSAGES_PER_RUN);
  if (!candidates.length) {
    return NextResponse.json({ ok: true, scanned: 0, reached: 0, communications, waitingOn, cleared, unmatched, outboundAiCalls, inboundAiCalls, autoApplied, timedOut });
  }

  const { data: seenRows } = await admin
    .from("gmail_processed_comms")
    .select("message_id")
    .in("message_id", candidates.map((c) => c.messageId));
  const seen = new Set((seenRows ?? []).map((r) => r.message_id as string));
  const fresh = candidates.filter((c) => !seen.has(c.messageId));

  let reached = 0;
  for (const msg of fresh) {
    if (!timeLeft()) {
      timedOut++;
      break;
    }
    reached++;

    try {
      const result = matchDeal(`${msg.subject} ${msg.snippet}`, deals);

      // Mark processed up front so a downstream failure never loops this message.
      await admin.from("gmail_processed_comms").upsert(
        {
          message_id: msg.messageId,
          deal_id: result.method === "matched" ? result.deal.id : null,
          direction: msg.direction,
        },
        { onConflict: "message_id" },
      );

      if (result.method !== "matched") {
        unmatched++;
        continue;
      }
      const deal = result.deal;

      // Timeline communication entry (both directions).
      await recordCommunication(admin, {
        dealId: deal.id,
        note: `${msg.direction === "sent" ? "Sent" : "Received"}: ${msg.subject || "(no subject)"}`,
      });
      communications++;

      if (msg.direction === "inbound") {
        // A reply arriving resolves any open waiting-on flags on the deal.
        cleared += await clearWaitingOn(admin, deal.id, `email:${msg.messageId}`);

        if (looksLikeLedgerSignal(msg.subject, msg.snippet) && inboundAiCalls < MAX_INBOUND_CLASSIFY_PER_RUN) {
          inboundAiCalls++;
          const cls = await classifyInboundEmail(msg.subject, msg.snippet);

          const autoChanges: ProposedChanges = {};
          const pendingChanges: ProposedChanges = {};

          if (cls.appraised_value != null) {
            if (isEmpty(deal.appraised_value)) {
              autoChanges.appraised_value = { new: cls.appraised_value, was: null };
              autoChanges.appraisal_conditions = {
                new: cls.subject_to_conditions ? cls.conditions_list : [],
                was: null,
              };
            } else if (deal.appraised_value !== cls.appraised_value) {
              pendingChanges.appraised_value = { new: cls.appraised_value, was: deal.appraised_value };
            }
          }

          if (cls.entity_name) {
            if (isEmpty(deal.entity_name)) autoChanges.entity_name = { new: cls.entity_name, was: null };
            else if (deal.entity_name !== cls.entity_name)
              pendingChanges.entity_name = { new: cls.entity_name, was: deal.entity_name };
          }

          if (cls.emd_receipt_detected && isEmpty(deal.emd_received_at)) {
            autoChanges.emd_received_at = { new: new Date().toISOString(), was: null };
          }

          const autoFieldNames = Object.keys(autoChanges);
          if (autoFieldNames.length) {
            await recordAutoApply(admin, {
              dealId: deal.id,
              source: "email",
              sourceRef: msg.messageId,
              eventType: "communication",
              summary: `Email from ${counterpartyFrom(msg.from)} — auto-applied ${autoFieldNames.join(", ")}`,
              changes: autoChanges,
            });
            autoApplied++;

            if (autoChanges.appraised_value) {
              await maybeTriggerPof(admin, {
                id: deal.id,
                property_address: deal.property_address,
                entity_name: (autoChanges.entity_name?.new as string | null) ?? deal.entity_name,
                appraised_value: autoChanges.appraised_value.new as number,
              });
            }
          }

          const pendingFieldNames = Object.keys(pendingChanges);
          if (pendingFieldNames.length) {
            await recordPending(admin, {
              dealId: deal.id,
              source: "email",
              sourceRef: msg.messageId,
              eventType: "emd_change",
              summary: `Email from ${counterpartyFrom(msg.from)} conflicts with current values — review ${pendingFieldNames.join(", ")}`,
              changes: pendingChanges,
            });
          }

          // Ledger advancement (Section 2c) — inbound content may confirm receipt/clearance
          // of a tracked item, or (unlike outbound) introduce a new deal-specific one.
          for (const item of cls.detected_items) {
            if (item.direction === "requested") continue; // an inbound ask of US isn't a receipt against our ledger
            await advanceOrCreateLedgerItem(admin, {
              dealId: deal.id,
              itemKeyGuess: item.item_key_guess,
              label: item.label,
              direction: item.direction,
              counterparty: item.counterparty,
              confidence: item.confidence,
              evidenceRef: `email:${msg.messageId}`,
              source: "ai_email",
              allowCreate: true,
              createdCount: aiCreatedCounts,
            });
          }

          // Vague "received" with no resolvable item — never guess, flag for manual review instead.
          if (cls.unresolved_received && cls.detected_items.length === 0) {
            await recordPending(admin, {
              dealId: deal.id,
              source: "email",
              sourceRef: msg.messageId,
              eventType: "doc_received",
              summary: `RECEIVED (unresolved): ${msg.subject || "(no subject)"}`,
            });
          }
        }

        continue;
      }

      // Outbound ("sent"): detect a request we're now waiting on (AI, prefiltered + capped).
      if (looksLikeRequest(msg.subject, msg.snippet) && outboundAiCalls < MAX_AI_CLASSIFY_PER_RUN) {
        outboundAiCalls++;
        const cls = await classifyOutboundEmail(msg.subject, msg.snippet);
        if (cls.is_request) {
          const who = counterpartyFrom(msg.to);
          await recordWaitingOn(admin, {
            dealId: deal.id,
            source: "email",
            sourceRef: msg.messageId,
            summary: `WAITING ON ${who}: ${cls.request ?? (msg.subject || "response")}`,
          });
          waitingOn++;

          // An outbound ask may match an EXISTING ledger item forward to 'requested' —
          // it may never create a new one or claim receipt (§ hard rule above).
          for (const item of cls.detected_items) {
            if (item.direction !== "requested") continue;
            await advanceOrCreateLedgerItem(admin, {
              dealId: deal.id,
              itemKeyGuess: item.item_key_guess,
              label: item.label,
              direction: "requested",
              counterparty: item.counterparty,
              confidence: item.confidence,
              evidenceRef: `email:${msg.messageId}`,
              source: "ai_email",
              allowCreate: false,
              createdCount: aiCreatedCounts,
            });
          }
        }
      }
    } catch (err) {
      console.error(`gmail-comms: failed processing message ${msg.messageId}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: fresh.length,
    reached,
    communications,
    waitingOn,
    cleared,
    unmatched,
    outboundAiCalls,
    inboundAiCalls,
    autoApplied,
    timedOut,
  });
}
