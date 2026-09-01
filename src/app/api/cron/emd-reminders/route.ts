import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { daysUntil } from "@/lib/types";
import { sendReminder, scheduleReminderEmail } from "@/lib/reminders";
import { money } from "@/lib/format";

export const runtime = "nodejs";

interface EmdCandidate {
  id: string;
  property_address: string;
  emd_amount: number | null;
  emd_hard_date: string;
  emd_extension_count: number;
  appraisal_received_at: string | null;
  emd_reminder_10_sent_at: string | null;
  emd_reminder_5_sent_at: string | null;
  emd_reminder_3_sent_at: string | null;
  emd_reminder_2_sent_at: string | null;
  emd_appraisal_reminder_sent_at: string | null;
}

/**
 * Reminder thresholds, ordered from least to most urgent (largest day-count
 * first). Each has its own idempotency stamp on the deal and its own
 * emd_events audit type. daysUntil <= days means the threshold is crossed.
 */
const THRESHOLDS = [
  { days: 10, col: "emd_reminder_10_sent_at", event: "reminder_10" },
  { days: 5, col: "emd_reminder_5_sent_at", event: "reminder_5" },
  { days: 3, col: "emd_reminder_3_sent_at", event: "reminder_3" },
  { days: 2, col: "emd_reminder_2_sent_at", event: "reminder_2" },
] as const;

type Threshold = (typeof THRESHOLDS)[number];

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
}

function runwaySummary(days: number, extensions: number): string {
  if (days < 0) return "EMD has gone hard — no negotiating runway remains.";
  if (days === 0) return "EMD goes hard today — no negotiating runway remains after today.";
  const runway = `${days} day${days === 1 ? "" : "s"} of negotiating runway`;
  return extensions > 0
    ? `${runway} left (${extensions} extension${extensions === 1 ? "" : "s"} already granted).`
    : `${runway} before EMD is non-refundable.`;
}

/** Reminders at 3 days or fewer read as urgent; 10/5-day read as heads-up. */
function subjectFor(t: Threshold, days: number, address: string): string {
  const tag = t.days <= 3 ? "EMD URGENT" : "EMD reminder";
  return `${tag} — ${days}d to hard date — ${address}`;
}

/**
 * ISO timestamp for 8:00 AM America/New_York on the morning AFTER `from`
 * (DST-aware). The nightly sweep runs ~10pm ET, so "the next morning" is the
 * following ET calendar day at 8am — 12:00 UTC under EDT, 13:00 UTC under EST.
 * Used for the section-3 scheduled "final window" follow-up (Resend scheduledAt).
 */
function morningFollowUpISO(from: Date): string {
  // from's ET calendar date (en-CA formats as YYYY-MM-DD).
  const etDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(from);
  const [y, m, d] = etDate.split("-").map(Number);
  // Next ET calendar day (UTC math handles month/year rollover cleanly).
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = next.getUTCMonth();
  const nd = next.getUTCDate();
  // Probe that morning to learn whether ET is on EST or EDT.
  const probe = new Date(Date.UTC(ny, nm, nd, 12, 0));
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value;
  const utcHour = zone === "EST" ? 13 : 12; // 8am EST = 13:00Z, 8am EDT = 12:00Z
  return new Date(Date.UTC(ny, nm, nd, utcHour, 0, 0)).toISOString();
}

function emailBody(params: {
  address: string;
  days: number;
  amount: number | null;
  extensions: number;
  lede?: string;
}): string {
  const { address, days, amount, extensions, lede } = params;
  const link = `${appUrl()}/dashboard/pipeline`;
  return `
    <div style="font-family:system-ui,sans-serif;color:#0a0a0a;line-height:1.6;max-width:560px">
      <h2 style="color:#0f1c3f;margin:0 0 4px">${address}</h2>
      ${lede ? `<p style="color:#b91c1c;font-weight:600;margin:0 0 12px">${lede}</p>` : ""}
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Days to EMD hard</td><td><b>${days < 0 ? "Past due" : days}</b></td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">EMD amount</td><td>${money(amount)}</td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Extensions granted</td><td>${extensions}</td></tr>
      </table>
      <p style="font-size:14px;margin:0 0 20px">${runwaySummary(days, extensions)}</p>
      <a href="${link}" style="background:#0f1c3f;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Open deal</a>
    </div>`;
}

/**
 * Daily EMD reminder sweep — thresholds at 10, 5, 3, and 2 days to the hard
 * date. Each hard date gets at most one email per run:
 *
 *  - A past-hard-date deal gets a single "went hard" alert (permanently, via
 *    the went_hard emd_event — no further threshold or appraisal reminders
 *    after that).
 *  - Otherwise the MOST URGENT unstamped crossed threshold is sent, and every
 *    other crossed-but-unstamped threshold is backfill-stamped silently — no
 *    email, no emd_event — so a deal that enters mid-window (e.g. already 4
 *    days out) sends only the 5-day notice and never fires the skipped 10-day
 *    one late.
 *
 * Stamps guard every send so each threshold fires exactly once per hard date
 * (changing emd_hard_date resets the stamps; see updateDealField in
 * pipeline/actions.ts). Legacy 7/4-day columns are retained but no longer
 * written. CRON_SECRET-guarded; folded into /api/cron/daily rather than given
 * its own vercel.json entry — Hobby caps cron jobs at 2, both already claimed
 * by daily + snapshot.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, property_address, emd_amount, emd_hard_date, emd_extension_count, appraisal_received_at, emd_reminder_10_sent_at, emd_reminder_5_sent_at, emd_reminder_3_sent_at, emd_reminder_2_sent_at, emd_appraisal_reminder_sent_at",
    )
    .eq("status", "active")
    .not("escrow_date", "is", null)
    .not("emd_hard_date", "is", null);

  if (error) {
    console.error("emd-reminders query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const deals = (data ?? []) as EmdCandidate[];
  const dealIds = deals.map((d) => d.id);

  const { data: hardEventRows } = dealIds.length
    ? await admin.from("emd_events").select("deal_id").eq("event_type", "went_hard").in("deal_id", dealIds)
    : { data: [] as { deal_id: string }[] };
  const alreadyHard = new Set((hardEventRows ?? []).map((r) => r.deal_id));

  let wentHard = 0;
  let appraisalAlerts = 0;
  let morningScheduled = 0;
  const reminders: Record<string, number> = { reminder_10: 0, reminder_5: 0, reminder_3: 0, reminder_2: 0 };

  for (const deal of deals) {
    const days = daysUntil(deal.emd_hard_date);
    const address = deal.property_address;

    // Past-hard-date takes priority and permanently silences threshold + appraisal reminders.
    if (days <= 0) {
      if (!alreadyHard.has(deal.id)) {
        try {
          await sendReminder({
            subject: `EMD IS NOW HARD on ${address}`,
            html: emailBody({
              address,
              days,
              amount: deal.emd_amount,
              extensions: deal.emd_extension_count,
              lede: "The EMD hard date has passed — earnest money is no longer refundable.",
            }),
          });
          const now = new Date().toISOString();
          await admin
            .from("deals")
            .update({
              emd_reminder_10_sent_at: now,
              emd_reminder_5_sent_at: now,
              emd_reminder_3_sent_at: now,
              emd_reminder_2_sent_at: now,
              emd_appraisal_reminder_sent_at: now,
            })
            .eq("id", deal.id);
          await admin.from("emd_events").insert({ deal_id: deal.id, event_type: "went_hard", detail: `hard date ${deal.emd_hard_date}` });
          wentHard++;
        } catch (e) {
          console.error(`emd-reminders: went-hard alert failed for ${deal.id}:`, e);
        }
      }
      continue;
    }

    // Crossed + unstamped thresholds, ordered least→most urgent. The most
    // urgent (smallest day-count, i.e. the last entry) is the one we email;
    // the rest are backfill-stamped silently.
    const due = THRESHOLDS.filter((t) => days <= t.days && !deal[t.col]);
    if (due.length) {
      const send = due[due.length - 1];
      try {
        await sendReminder({
          subject: subjectFor(send, days, address),
          html: emailBody({ address, days, amount: deal.emd_amount, extensions: deal.emd_extension_count }),
        });
        const now = new Date().toISOString();
        const updates: Record<string, string> = {};
        for (const t of due) updates[t.col] = now; // stamp the sent one + backfill the rest
        await admin.from("deals").update(updates).eq("id", deal.id);
        await admin.from("emd_events").insert({ deal_id: deal.id, event_type: send.event, detail: `${days}d to hard date` });
        reminders[send.event]++;

        // Section 3: the night the 2-day reminder fires (exactly 2 days out),
        // also schedule the 8am "final window" follow-up for the next morning
        // via Resend scheduledAt — no morning cron slot exists on Hobby. Only
        // at days === 2 (not a late 1-day entry, where no morning remains).
        if (send.event === "reminder_2" && days === 2) {
          try {
            const scheduledAt = morningFollowUpISO(new Date());
            const emailId = await scheduleReminderEmail({
              subject: `FINAL WINDOW: 1 business day to extend EMD on ${address}`,
              html: emailBody({
                address,
                days: 1,
                amount: deal.emd_amount,
                extensions: deal.emd_extension_count,
                lede: "One business day left to request an EMD extension — act this morning before the window closes.",
              }),
              scheduledAt,
            });
            // Store the scheduled email id so a hard-date change can cancel it
            // before it sends (see updateDealField in pipeline/actions.ts).
            if (emailId) await admin.from("deals").update({ emd_morning_email_id: emailId }).eq("id", deal.id);
            await admin
              .from("emd_events")
              .insert({ deal_id: deal.id, event_type: "reminder_1_morning", detail: `scheduled ${scheduledAt}${emailId ? ` (${emailId})` : ""}` });
            morningScheduled++;
          } catch (e) {
            console.error(`emd-reminders: morning follow-up scheduling failed for ${deal.id}:`, e);
          }
        }
      } catch (e) {
        console.error(`emd-reminders: ${send.event} failed for ${deal.id}:`, e);
      }
    }

    if (deal.appraisal_received_at && !deal.emd_appraisal_reminder_sent_at) {
      try {
        await sendReminder({
          subject: `APPRAISAL BACK — ${days} days until EMD hard on ${address}`,
          html: emailBody({
            address,
            days,
            amount: deal.emd_amount,
            extensions: deal.emd_extension_count,
            lede: "Appraisal report received.",
          }),
        });
        await admin.from("deals").update({ emd_appraisal_reminder_sent_at: new Date().toISOString() }).eq("id", deal.id);
        await admin.from("emd_events").insert({ deal_id: deal.id, event_type: "appraisal_alert", detail: `${days}d to hard date` });
        appraisalAlerts++;
      } catch (e) {
        console.error(`emd-reminders: appraisal alert failed for ${deal.id}:`, e);
      }
    }
  }

  return NextResponse.json({ ok: true, wentHard, ...reminders, morningScheduled, appraisalAlerts, total: deals.length });
}
