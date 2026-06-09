import { NextResponse } from "next/server";
import { GET as deadlinesGET } from "@/app/api/alerts/deadlines/route";
import { GET as cleanupGET } from "@/app/api/deals/cleanup/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Consolidated daily cron — runs the deadline digest and the dead-deal cleanup
 * in one job. Hobby allows only 2 cron jobs, so these two share a slot to leave
 * room for the weekly snapshot. Each sub-handler does its own CRON_SECRET check.
 */
export async function GET(req: Request) {
  const deadlines = await deadlinesGET(req);
  const cleanup = await cleanupGET(req);
  return NextResponse.json({
    ok: true,
    deadlines: deadlines.status,
    cleanup: cleanup.status,
  });
}
