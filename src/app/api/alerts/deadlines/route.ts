import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDeadlineDigest, type DeadlineAlert } from "@/lib/email";

export const runtime = "nodejs";

// Fire at 10, 5, and 2 days before a milestone.
const ALERT_DAYS = new Set([10, 5, 2]);

function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export async function GET(req: Request) {
  // If a CRON_SECRET is configured, require it (Vercel cron sends it as Bearer).
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Milestone deadline digest.
  const { data: milestones } = await admin
    .from("deal_milestones")
    .select("label, target_date, deal:deal_id(property_address)");

  const alerts: DeadlineAlert[] = ((milestones ?? []) as unknown as {
    label: string;
    target_date: string;
    deal: { property_address: string } | null;
  }[])
    .map((m) => ({
      deal_address: m.deal?.property_address ?? "—",
      label: m.label,
      target_date: m.target_date,
      days: daysUntil(m.target_date),
    }))
    .filter((a) => ALERT_DAYS.has(a.days))
    .sort((a, b) => a.days - b.days);

  let emailed = false;
  try {
    if (alerts.length > 0) {
      await sendDeadlineDigest(alerts);
      emailed = true;
    }
  } catch (e) {
    console.error("deadline digest send failed:", e);
  }

  // Dead-deal cleanup lives in /api/deals/cleanup (separate cron entry).
  return NextResponse.json({ ok: true, alerts: alerts.length, emailed });
}
