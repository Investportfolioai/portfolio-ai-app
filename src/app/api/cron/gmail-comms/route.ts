import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { searchDealCommunications } from "@/lib/gmail";
import { matchDeal, addressSearchPhrases, type MatchableDeal } from "@/lib/deal-match";
import { recordCommunication, recordWaitingOn, clearWaitingOn } from "@/lib/deal-updates";
import { classifyOutboundEmail } from "@/lib/underwriting";

export const runtime = "nodejs";
export const maxDuration = 60;

// Bounds for one run — comms scanning is lighter than attachment extraction,
// but it shares /api/cron/daily's 60s budget with the attachment scan and the
// nightly digest. Kept conservative here; the shared cross-step budget is
// reconciled in section 6.
const MAX_COMM_MESSAGES_PER_RUN = 12;
const MAX_AI_CLASSIFY_PER_RUN = 8;
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

function looksLikeRequest(subject: string, snippet: string): boolean {
  const t = `${subject} ${snippet}`.toLowerCase();
  return REQUEST_HINTS.some((k) => t.includes(k));
}

/** Human-ish counterparty label from a "Name <email>" header. */
function counterpartyFrom(header: string): string {
  const named = header.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named) return named[1].trim();
  const email = header.match(/[^\s<>]+@[^\s<>]+/);
  return email ? email[0] : header.trim() || "counterparty";
}

/**
 * Section 5 — sent + inbound communication scan. Deal-matched OUTBOUND emails
 * become timeline 'communication' entries; an AI-detected outbound REQUEST also
 * creates a waiting-on marker (deal_updates status 'auto', event_type 'task').
 * INBOUND mail clears any open waiting-on markers on the deal.
 *
 * HARD RULE (enforced here structurally): sent mail NEVER writes a field or a
 * date — this route only calls recordCommunication / recordWaitingOn /
 * clearWaitingOn, never recordAutoApply/recordPending or deals.update. Only the
 * attachment scan (signed docs) or an operator can change deal data.
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
  let aiCalls = 0;
  let timedOut = 0;

  const { data: dealRows } = await admin
    .from("deals")
    .select("id, property_address")
    .in("status", ["active", "pending"]);
  const deals = (dealRows ?? []) as MatchableDeal[];
  const phrases = addressSearchPhrases(deals);
  if (!phrases.length) {
    return NextResponse.json({ ok: true, scanned: 0, reached: 0, communications, waitingOn, cleared, unmatched, aiCalls, timedOut });
  }

  const candidates = (await searchDealCommunications(phrases)).slice(0, MAX_COMM_MESSAGES_PER_RUN);
  if (!candidates.length) {
    return NextResponse.json({ ok: true, scanned: 0, reached: 0, communications, waitingOn, cleared, unmatched, aiCalls, timedOut });
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
        continue;
      }

      // Outbound: detect a request we're now waiting on (AI, prefiltered + capped).
      if (looksLikeRequest(msg.subject, msg.snippet) && aiCalls < MAX_AI_CLASSIFY_PER_RUN) {
        aiCalls++;
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
    aiCalls,
    timedOut,
  });
}
