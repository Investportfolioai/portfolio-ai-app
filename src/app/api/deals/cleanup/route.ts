import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEAD_DEAL_TTL_DAYS } from "@/lib/types";

export const runtime = "nodejs";

/** Deletes dead deals whose 120-day TTL has elapsed. Runs on the daily cron. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - DEAD_DEAL_TTL_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("deals")
    .delete()
    .eq("status", "dead")
    .lt("status_changed_at", cutoff)
    .select("id");

  if (error) {
    console.error("dead-deal cleanup failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
}
