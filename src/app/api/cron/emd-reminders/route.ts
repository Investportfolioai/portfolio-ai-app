import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { daysUntil } from "@/lib/types";
import { sendReminder } from "@/lib/reminders";
import { money } from "@/lib/format";

export const runtime = "nodejs";

interface EmdCandidate {
  id: string;
  property_address: string;
  emd_amount: number | null;
  emd_hard_date: string;
  emd_extension_count: number;
  appraisal_received_at: string | null;
  emd_reminder_7_sent_at: string | null;
  emd_reminder_4_sent_at: string | null;
  emd_appraisal_reminder_sent_at: string | null;
}

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
 * Daily EMD reminder sweep — 7-day / 4-day escalating reminders and an
 * appraisal-received alert, each guarded by a sent-stamp so it fires exactly
 * once per hard date (changing emd_hard_date resets the stamps; see
 * updateDealField in pipeline/actions.ts). CRON_SECRET-guarded; folded into
 * /api/cron/daily rather than given its own vercel.json entry — Hobby caps
 * cron jobs at 2, both already claimed by daily + snapshot.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, property_address, emd_amount, emd_hard_date, emd_extension_count, appraisal_received_at, emd_reminder_7_sent_at, emd_reminder_4_sent_at, emd_appraisal_reminder_sent_at",
    )
    .eq("status", "active")
    .not("escrow_date", "is", null)
    .not("emd_hard_date", "is", null);

  if (error) {
    console.error("emd-reminders query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let reminder7 = 0;
  let reminder4 = 0;
  let appraisalAlerts = 0;

  for (const deal of (data ?? []) as EmdCandidate[]) {
    const days = daysUntil(deal.emd_hard_date);
    const address = deal.property_address;

    if (days <= 7 && !deal.emd_reminder_7_sent_at) {
      try {
        await sendReminder({
          subject: `EMD reminder — ${days}d to hard date — ${address}`,
          html: emailBody({ address, days, amount: deal.emd_amount, extensions: deal.emd_extension_count }),
        });
        await admin.from("deals").update({ emd_reminder_7_sent_at: new Date().toISOString() }).eq("id", deal.id);
        await admin.from("emd_events").insert({ deal_id: deal.id, event_type: "reminder_7", detail: `${days}d to hard date` });
        reminder7++;
      } catch (e) {
        console.error(`emd-reminders: 7-day reminder failed for ${deal.id}:`, e);
      }
    }

    if (days <= 4 && !deal.emd_reminder_4_sent_at) {
      try {
        await sendReminder({
          subject: `EMD URGENT — ${days}d to hard date — ${address}`,
          html: emailBody({ address, days, amount: deal.emd_amount, extensions: deal.emd_extension_count }),
        });
        await admin.from("deals").update({ emd_reminder_4_sent_at: new Date().toISOString() }).eq("id", deal.id);
        await admin.from("emd_events").insert({ deal_id: deal.id, event_type: "reminder_4", detail: `${days}d to hard date` });
        reminder4++;
      } catch (e) {
        console.error(`emd-reminders: 4-day reminder failed for ${deal.id}:`, e);
      }
    }

    if (deal.appraisal_received_at && !deal.emd_appraisal_reminder_sent_at) {
      try {
        const daysLabel = days < 0 ? 0 : days;
        await sendReminder({
          subject: `APPRAISAL BACK — ${daysLabel} days until EMD hard on ${address}`,
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

  return NextResponse.json({ ok: true, reminder7, reminder4, appraisalAlerts, total: data?.length ?? 0 });
}
