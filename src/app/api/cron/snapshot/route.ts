import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalloonStatus } from "@/lib/balloon";
import { sendBalloonAlert } from "@/lib/email-balloon";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Weekly cron: snapshot each holding's current AVM (once/day max) and email a
 * balloon alert for any holding now in a high/critical window. Secured by the
 * optional CRON_SECRET bearer header (matches the other cron routes).
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: holdings, error } = await admin
    .from("holdings")
    .select("id, address, zillow_avm, balloon_date, extension_clause, important_notes, monthly_payment");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  let snapshotted = 0;
  let alerts = 0;

  for (const h of holdings ?? []) {
    // Snapshot (idempotent per day).
    const { data: existing } = await admin
      .from("holding_snapshots")
      .select("id")
      .eq("holding_id", h.id)
      .eq("snapshot_date", today)
      .maybeSingle();
    if (!existing) {
      const { error: insErr } = await admin
        .from("holding_snapshots")
        .insert({ holding_id: h.id, avm_value: h.zillow_avm ?? null, snapshot_date: today });
      if (!insErr) snapshotted++;
    }

    // Balloon alert for high/critical windows.
    const status = getBalloonStatus(h.balloon_date);
    if (status.urgency === "high" || status.urgency === "critical") {
      try {
        await sendBalloonAlert(
          {
            address: h.address,
            balloon_date: h.balloon_date,
            extension_clause: h.extension_clause,
            important_notes: h.important_notes,
            monthly_payment: h.monthly_payment,
          },
          status,
        );
        alerts++;
      } catch (e) {
        console.warn("[snapshot] balloon alert failed:", (e as Error).message);
      }
    }
  }

  return NextResponse.json({ ok: true, snapshotted, alerts, total: holdings?.length ?? 0 });
}
