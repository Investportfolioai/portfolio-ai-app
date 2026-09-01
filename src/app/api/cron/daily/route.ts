import { NextResponse } from "next/server";
import { GET as deadlinesGET } from "@/app/api/alerts/deadlines/route";
import { GET as cleanupGET } from "@/app/api/deals/cleanup/route";
import { GET as emdRemindersGET } from "@/app/api/cron/emd-reminders/route";
import { GET as gmailScanGET } from "@/app/api/cron/gmail-scan/route";
import { GET as gmailCommsGET } from "@/app/api/cron/gmail-comms/route";
import { GET as digestGET } from "@/app/api/cron/digest/route";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Clone the cron request with a shared absolute deadline (epoch ms) header. */
function withDeadline(req: Request, deadlineMs: number): Request {
  const headers = new Headers(req.headers);
  headers.set("x-cron-deadline", String(deadlineMs));
  return new Request(req.url, { method: req.method, headers });
}

/**
 * Consolidated nightly cron (10pm ET) — deadline alerts, dead-deal cleanup,
 * EMD reminder sweep, the nightly overview PDF digest, then the Gmail
 * attachment + sent/inbound communication scans, in one job. Hobby allows only
 * 2 cron jobs, so these share a slot to leave room for the weekly snapshot.
 * Requires the CRON_SECRET bearer token.
 *
 * Order matters: the digest runs BEFORE the scans, with full headroom, and
 * summarizes state as of last night's scans (correct for a nightly report).
 * The scans run last and are the only yielding jobs — they honor absolute
 * x-cron-deadline headers so the whole fan-out stays inside the 60s function.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  // Digest runs early and unbounded; the scans (last) yield at these absolute
  // deadlines, leaving a safety tail under the 60s function budget.
  const SCAN_DEADLINE = startedAt + 48_000;
  const COMMS_DEADLINE = startedAt + 55_000;

  const deadlines = await deadlinesGET(req);
  const cleanup = await cleanupGET(req);
  const emdReminders = await emdRemindersGET(req);
  const digest = await digestGET(req);
  const gmailScan = await gmailScanGET(withDeadline(req, SCAN_DEADLINE));
  const gmailComms = await gmailCommsGET(withDeadline(req, COMMS_DEADLINE));
  return NextResponse.json({
    ok: true,
    deadlines: deadlines.status,
    cleanup: cleanup.status,
    emdReminders: emdReminders.status,
    digest: digest.status,
    gmailScan: gmailScan.status,
    gmailComms: gmailComms.status,
  });
}
