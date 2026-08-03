import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { searchAttachmentCandidates, listPdfAttachments, fetchAttachmentBytes } from "@/lib/gmail";
import { extractDocumentUpdates } from "@/lib/underwriting";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "deal-documents";

// Hard cap on candidate messages examined per run — a stopgap ahead of
// Phase 3's real resumable-cursor batching. Unmatched messages are nearly
// free to reject, so this really bounds worst-case matched-and-extracted
// count within the shared 60s budget of /api/cron/daily.
const MAX_MESSAGES_PER_RUN = 5;

// A single message can carry many PDFs (a real escrow package easily has
// 8-10 disclosure/advisory forms) — cap attachments per message so one busy
// thread can't alone exhaust the run's time budget.
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

// Wall-clock budget for the whole run, held well under maxDuration (60s) so
// there's always time left to exit cleanly instead of hitting a hard
// FUNCTION_INVOCATION_TIMEOUT mid-write. Checked before starting each new
// message and each new attachment; a message cut short is unmarked from
// gmail_processed_messages so it retries in full next run.
const RUN_TIME_BUDGET_MS = 45_000;

interface CandidateDeal {
  id: string;
  property_address: string;
  emd_hard_date: string | null;
  emd_amount: number | null;
  appraisal_received_at: string | null;
}

/** Street-number token + significant word tokens from a free-text address. */
function tokenizeAddress(address: string): { streetNumber: string | null; words: string[] } {
  const tokens = address.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const streetNumber = tokens.find((t) => /^\d+$/.test(t)) ?? null;
  const words = tokens.filter((t) => !/^\d+$/.test(t) && t.length > 3);
  return { streetNumber, words };
}

type MatchResult =
  | { method: "matched"; deal: CandidateDeal }
  | { method: "unmatched" }
  | { method: "ambiguous"; candidates: CandidateDeal[] };

/**
 * Anchored on the street number (unlike the looser "any 2 words" matcher
 * used for WhatsApp) — financial documents are higher stakes than a text
 * message. Requires the street number AND at least one street-name word to
 * appear in the message text. Zero or multiple matches both fall back to
 * "don't guess" (unmatched / ambiguous).
 */
function matchDeal(text: string, deals: CandidateDeal[]): MatchResult {
  const lower = text.toLowerCase();
  const matches: CandidateDeal[] = [];
  for (const deal of deals) {
    const { streetNumber, words } = tokenizeAddress(deal.property_address);
    if (!streetNumber) continue;
    if (lower.includes(streetNumber) && words.some((w) => lower.includes(w))) {
      matches.push(deal);
    }
  }
  if (matches.length === 1) return { method: "matched", deal: matches[0] };
  if (matches.length === 0) return { method: "unmatched" };
  return { method: "ambiguous", candidates: matches };
}

/**
 * Daily Gmail scan for EMD-relevant PDFs (contracts, addenda, appraisals,
 * extensions), matched to a deal by address, filed into the existing
 * deal-documents storage (DOCS tab), and AI-extracted into the Phase 1 EMD
 * fields — writing only where the deal's field is currently null; a
 * conflicting extracted hard date is logged as an emd_event instead of
 * overwriting the operator-set value. Storage-only (no Drive — see
 * Phase 2 plan). CRON_SECRET-guarded; folded into /api/cron/daily rather
 * than given its own vercel.json entry — Hobby caps cron jobs at 2, both
 * already claimed by daily + snapshot.
 *
 * Three layered guards keep a single run bounded: MAX_MESSAGES_PER_RUN caps
 * candidate messages examined, MAX_ATTACHMENTS_PER_MESSAGE caps attachments
 * within one message (a real escrow package can carry 8-10 PDFs and alone
 * exhaust the run), and the RUN_TIME_BUDGET_MS wall-clock guard stops the
 * run cleanly with room to spare under maxDuration — any message it cuts
 * off mid-attachment-list is unmarked from gmail_processed_messages so it
 * retries in full next run instead of being silently left half-done.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();
  const timeLeft = () => Date.now() - startedAt < RUN_TIME_BUDGET_MS;

  const candidates = (await searchAttachmentCandidates()).slice(0, MAX_MESSAGES_PER_RUN);
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let applied = 0;
  let errors = 0;
  let timedOut = 0;

  if (!candidates.length) {
    return NextResponse.json({ ok: true, scanned: 0, reached: 0, remaining: 0, matched, unmatched, ambiguous, applied, errors, timedOut });
  }

  const { data: seenRows } = await admin
    .from("gmail_processed_messages")
    .select("message_id")
    .in("message_id", candidates.map((c) => c.messageId));
  const seen = new Set((seenRows ?? []).map((r) => r.message_id as string));
  const fresh = candidates.filter((c) => !seen.has(c.messageId));

  if (!fresh.length) {
    return NextResponse.json({ ok: true, scanned: candidates.length, reached: 0, remaining: 0, matched, unmatched, ambiguous, applied, errors, timedOut });
  }

  const { data: dealRows } = await admin
    .from("deals")
    .select("id, property_address, emd_hard_date, emd_amount, appraisal_received_at")
    .in("status", ["active", "pending"]);
  const deals = (dealRows ?? []) as CandidateDeal[];

  let reached = 0;
  for (const candidate of fresh) {
    if (!timeLeft()) {
      timedOut++;
      break;
    }
    reached++;

    try {
      const result = matchDeal(`${candidate.subject} ${candidate.snippet}`, deals);

      // Mark processed before any attachment work — so a downstream failure
      // never leaves this message eligible for endless retry, and the FK on
      // emd_extraction_staging.gmail_message_id is satisfied up front.
      await admin.from("gmail_processed_messages").upsert(
        { message_id: candidate.messageId, deal_id: result.method === "matched" ? result.deal.id : null },
        { onConflict: "message_id" },
      );

      if (result.method === "unmatched") {
        unmatched++;
        await admin.from("emd_extraction_staging").insert({
          gmail_message_id: candidate.messageId,
          deal_id: null,
          match_method: "unmatched",
        });
        continue;
      }

      if (result.method === "ambiguous") {
        ambiguous++;
        await admin.from("emd_extraction_staging").insert({
          gmail_message_id: candidate.messageId,
          deal_id: null,
          match_method: "ambiguous",
          match_detail: result.candidates.map((d) => `${d.id}:${d.property_address}`).join(" | "),
        });
        continue;
      }

      // Matched — only now do we spend anything on downloading/extracting.
      matched++;
      const deal = result.deal;
      const attachments = (await listPdfAttachments(candidate.messageId)).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

      if (!attachments.length) {
        await admin.from("emd_extraction_staging").insert({
          gmail_message_id: candidate.messageId,
          deal_id: deal.id,
          match_method: "matched",
          match_detail: `${deal.property_address} — no PDF part found on full fetch`,
        });
        continue;
      }

      let cutShort = false;
      for (const att of attachments) {
        if (!timeLeft()) {
          cutShort = true;
          break;
        }
        try {
          const bytes = await fetchAttachmentBytes(candidate.messageId, att.attachmentId);
          if (!bytes) {
            await admin.from("emd_extraction_staging").insert({
              gmail_message_id: candidate.messageId,
              deal_id: deal.id,
              attachment_filename: att.filename,
              match_method: "matched",
              match_detail: `${deal.property_address} — attachment download failed`,
            });
            errors++;
            continue;
          }

          const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `${deal.id}/${Date.now()}-${safeName}`;
          const up = await admin.storage.from(BUCKET).upload(path, bytes, {
            contentType: "application/pdf",
            upsert: false,
          });
          if (up.error) throw new Error(`storage upload failed: ${up.error.message}`);

          const { data: docRow } = await admin
            .from("deal_documents")
            .insert({ deal_id: deal.id, file_name: att.filename, file_url: path, file_type: "application/pdf" })
            .select("id")
            .single();

          let extraction: Awaited<ReturnType<typeof extractDocumentUpdates>> | null = null;
          try {
            extraction = await extractDocumentUpdates(bytes.toString("base64"));
          } catch (e) {
            console.error(`gmail-scan: extraction failed for ${candidate.messageId}/${att.filename}:`, e);
          }

          const appliedFields: Record<string, string | number> = {};
          const conflictFields: Record<string, { extracted: string | number; existing: string | number }> = {};

          if (extraction) {
            const emdMilestone = extraction.milestones
              .filter((m) => m.milestone_type === "emd")
              .sort((a, b) => a.target_date.localeCompare(b.target_date))[0];
            if (emdMilestone) {
              if (deal.emd_hard_date == null) {
                appliedFields.emd_hard_date = emdMilestone.target_date;
              } else if (deal.emd_hard_date !== emdMilestone.target_date) {
                conflictFields.emd_hard_date = { extracted: emdMilestone.target_date, existing: deal.emd_hard_date };
                await admin.from("emd_events").insert({
                  deal_id: deal.id,
                  event_type: "date_changed",
                  detail: `extracted ${emdMilestone.target_date} conflicts with set ${deal.emd_hard_date} — review`,
                });
              }
            }

            if (extraction.emd_amount != null) {
              if (deal.emd_amount == null) {
                appliedFields.emd_amount = extraction.emd_amount;
              } else if (deal.emd_amount !== extraction.emd_amount) {
                conflictFields.emd_amount = { extracted: extraction.emd_amount, existing: deal.emd_amount };
              }
            }

            if (extraction.appraisal_detected && deal.appraisal_received_at == null) {
              appliedFields.appraisal_received_at = new Date().toISOString();
            }
          }

          if (Object.keys(appliedFields).length > 0) {
            await admin.from("deals").update(appliedFields).eq("id", deal.id);
            applied++;
          }

          await admin.from("emd_extraction_staging").insert({
            gmail_message_id: candidate.messageId,
            deal_id: deal.id,
            deal_document_id: docRow?.id ?? null,
            attachment_filename: att.filename,
            match_method: "matched",
            match_detail: deal.property_address,
            extracted: extraction,
            applied_fields: Object.keys(appliedFields).length ? appliedFields : null,
            conflict_fields: Object.keys(conflictFields).length ? conflictFields : null,
          });
        } catch (attErr) {
          console.error(`gmail-scan: attachment processing failed for ${candidate.messageId}/${att.filename}:`, attErr);
          errors++;
          await admin.from("emd_extraction_staging").insert({
            gmail_message_id: candidate.messageId,
            deal_id: deal.id,
            attachment_filename: att.filename,
            match_method: "matched",
            match_detail: `${deal.property_address} — processing error, see server logs`,
          });
        }
      }

      if (cutShort) {
        // Didn't finish this message's attachments within budget — unmark it
        // so the dedupe ledger lets it retry in full next run rather than
        // silently treating it as done. Whatever attachments did complete
        // above are left in place (no rollback); a retry may reprocess them.
        await admin.from("gmail_processed_messages").delete().eq("message_id", candidate.messageId);
        timedOut++;
        break;
      }
    } catch (err) {
      console.error(`gmail-scan: failed processing message ${candidate.messageId}:`, err);
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: fresh.length,
    reached,
    remaining: fresh.length - reached,
    matched,
    unmatched,
    ambiguous,
    applied,
    errors,
    timedOut,
  });
}
