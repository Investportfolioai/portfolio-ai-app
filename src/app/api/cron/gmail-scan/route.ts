import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { searchAttachmentCandidates, listPdfAttachments, fetchAttachmentBytes } from "@/lib/gmail";
import { extractDocumentUpdates } from "@/lib/underwriting";
import { recordAutoApply, recordPending, clearWaitingOn, isEmpty } from "@/lib/deal-updates";
import { matchDeal } from "@/lib/deal-match";
import type { ProposedChanges } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "deal-documents";

// Cap on candidate messages examined per run. Unmatched messages are nearly
// free to reject, so this really bounds the worst-case matched-and-extracted
// count. Raised 5 → 12 (Automation Push §6): at current volume the real
// governor is the wall-clock deadline below, not this count, and 12 clears a
// busy escrow day's backlog in a single nightly run without risking the shared
// 60s budget of /api/cron/daily.
const MAX_MESSAGES_PER_RUN = 12;

// A single message can carry many PDFs (a real escrow package easily has
// 8-10 disclosure/advisory forms) — cap attachments per message so one busy
// thread can't alone exhaust the run's time budget.
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

// Standalone wall-clock budget, used only when this route is invoked directly
// (manual/testing). Inside /api/cron/daily the fan-out passes a shared absolute
// deadline via the x-cron-deadline header so scan → comms → digest all fit the
// one 60s function; that deadline takes precedence over this fallback. Checked
// before each new message and attachment; a message cut short is unmarked from
// gmail_processed_messages so it retries in full next run.
const RUN_TIME_BUDGET_MS = 45_000;

interface CandidateDeal {
  id: string;
  property_address: string;
  emd_hard_date: string | null;
  emd_amount: number | null;
  appraisal_received_at: string | null;
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
  // Prefer the shared cross-step deadline from /api/cron/daily; fall back to a
  // standalone budget for direct invocation.
  const headerDeadline = Number(req.headers.get("x-cron-deadline")) || 0;
  const budgetEnd = headerDeadline || Date.now() + RUN_TIME_BUDGET_MS;
  const timeLeft = () => Date.now() < budgetEnd;

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

          const docType = extraction?.doc_type ?? null;
          const documentDate = extraction?.document_date ?? null;
          const autoChanges: ProposedChanges = {};
          const pendingChanges: ProposedChanges = {};

          if (extraction) {
            const emdMilestone = extraction.milestones
              .filter((m) => m.milestone_type === "emd")
              .sort((a, b) => a.target_date.localeCompare(b.target_date))[0];
            if (emdMilestone) {
              // Null → auto-fill baseline; conflict → one-tap queue (never silently override).
              if (isEmpty(deal.emd_hard_date)) autoChanges.emd_hard_date = { new: emdMilestone.target_date, was: null };
              else if (deal.emd_hard_date !== emdMilestone.target_date)
                pendingChanges.emd_hard_date = { new: emdMilestone.target_date, was: deal.emd_hard_date };
            }

            if (extraction.emd_amount != null) {
              if (isEmpty(deal.emd_amount)) autoChanges.emd_amount = { new: extraction.emd_amount, was: null };
              else if (deal.emd_amount !== extraction.emd_amount)
                pendingChanges.emd_amount = { new: extraction.emd_amount, was: deal.emd_amount };
            }

            if (extraction.appraisal_detected && isEmpty(deal.appraisal_received_at)) {
              autoChanges.appraisal_received_at = { new: new Date().toISOString(), was: null };
            }
          }

          // Section 4: the document filing itself always auto-applies (filed to
          // DOCS above) — recorded as one 'auto' row carrying any null-fill
          // field writes (undoable). Conflicts route to the one-tap queue with
          // doc-type + document-date provenance shown on the card.
          const autoFieldNames = Object.keys(autoChanges);
          await recordAutoApply(admin, {
            dealId: deal.id,
            source: extraction?.appraisal_detected ? "appraisal_report" : "email",
            sourceRef: att.filename,
            docType,
            documentDate,
            eventType: "doc_received",
            summary: `Filed ${att.filename}${docType ? ` (${docType})` : ""}${autoFieldNames.length ? ` — auto-applied ${autoFieldNames.join(", ")}` : ""}`,
            changes: autoFieldNames.length ? autoChanges : undefined,
          });
          if (autoFieldNames.length) applied++;

          // A signed document arriving on the deal clears any open waiting-on flags (section 5).
          await clearWaitingOn(admin, deal.id, `doc:${att.filename}`);

          const pendingFieldNames = Object.keys(pendingChanges);
          if (pendingFieldNames.length) {
            const supersede = docType === "addendum" || docType === "extension";
            await recordPending(admin, {
              dealId: deal.id,
              source: "email",
              sourceRef: att.filename,
              docType,
              documentDate,
              eventType: "emd_change",
              summary: `${docType ?? "Document"}${documentDate ? ` dated ${documentDate}` : ""} ${supersede ? "supersedes prior terms" : "conflicts with current values"} — review ${pendingFieldNames.join(", ")}`,
              changes: pendingChanges,
            });
          }

          await admin.from("emd_extraction_staging").insert({
            gmail_message_id: candidate.messageId,
            deal_id: deal.id,
            deal_document_id: docRow?.id ?? null,
            attachment_filename: att.filename,
            match_method: "matched",
            match_detail: deal.property_address,
            extracted: extraction,
            applied_fields: autoFieldNames.length ? autoChanges : null,
            conflict_fields: pendingFieldNames.length ? pendingChanges : null,
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
