import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { daysUntil } from "@/lib/types";
import { money } from "@/lib/format";
import { renderDigestPdf, type DigestData, type DigestDealSection } from "@/lib/digest-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const FROM = "Portfolio AI <deals@mail.investportfolio.ai>";
const TO = ["john@investportfolio.ai", "dani@investportfolio.ai", "loa@investportfolio.ai"];
const REPLY_TO = ["john@investportfolio.ai", "loa@investportfolio.ai"];

interface EscrowDeal {
  id: string;
  property_address: string;
  stage: string | null;
  stage_override: string | null;
  status_changed_at: string | null;
  escrow_date: string | null;
  emd_hard_date: string | null;
  emd_amount: number | null;
  appraisal_received_at: string | null;
}

interface UpdateRow {
  deal_id: string;
  event_type: string;
  summary: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

function titleize(v: string): string {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysBetween(fromIso: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000));
}

function emdLine(deal: EscrowDeal): string {
  if (!deal.emd_hard_date) return "not set";
  const d = daysUntil(deal.emd_hard_date);
  const countdown = d < 0 ? "past due" : d === 0 ? "today" : `${d}d`;
  const amount = deal.emd_amount != null ? `${money(deal.emd_amount)} · ` : "";
  return `${amount}hard ${deal.emd_hard_date} (${countdown})`;
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(now);
  // TEMPORARY test override (CRON_SECRET-guarded): ?section=week_in_review |
  // week_ahead | both forces the weekly sections on any day. Remove after
  // the live-test pass.
  const forceSection = new URL(req.url).searchParams.get("section");

  const { data: stateRow } = await admin.from("digest_state").select("last_digest_at").eq("id", 1).maybeSingle();
  const lastDigestAt = stateRow?.last_digest_at ?? new Date(now.getTime() - 86_400_000).toISOString();

  // Escrow deals = active with an escrow date set.
  const { data: dealRows } = await admin
    .from("deals")
    .select(
      "id, property_address, stage, stage_override, status_changed_at, escrow_date, emd_hard_date, emd_amount, appraisal_received_at",
    )
    .eq("status", "active")
    .not("escrow_date", "is", null)
    .order("emd_hard_date", { ascending: true, nullsFirst: false });
  const deals = (dealRows ?? []) as EscrowDeal[];
  const dealIds = deals.map((d) => d.id);

  // All relevant updates for those deals, bucketed in memory.
  const updates: UpdateRow[] = dealIds.length
    ? (((await admin
        .from("deal_updates")
        .select("deal_id, event_type, summary, status, created_at, reviewed_at")
        .in("deal_id", dealIds)).data ?? []) as UpdateRow[])
    : [];

  const byDeal = (predicate: (u: UpdateRow) => boolean) => {
    const map: Record<string, string[]> = {};
    for (const u of updates) if (predicate(u)) (map[u.deal_id] ??= []).push(u.summary);
    return map;
  };
  const waitingByDeal = byDeal((u) => u.status === "auto" && u.event_type === "task");
  const autoByDeal = byDeal((u) => u.status === "auto" && u.event_type !== "task" && u.created_at > lastDigestAt);
  const pendingByDeal = byDeal((u) => u.status === "pending");

  const dealSections: DigestDealSection[] = deals.map((d) => ({
    address: d.property_address,
    stageLabel: titleize(d.stage_override ?? d.stage ?? "—"),
    inEscrowDays: d.escrow_date ? daysBetween(d.escrow_date, now) : null,
    emdLine: emdLine(d),
    appraisal: d.appraisal_received_at ? `Received ${d.appraisal_received_at.slice(0, 10)}` : "Pending",
    waitingOn: waitingByDeal[d.id] ?? [],
    autoApplied: autoByDeal[d.id] ?? [],
    pending: pendingByDeal[d.id] ?? [],
  }));

  // EMD exposure header.
  let exposureHardNow = 0;
  let goingHardSum = 0;
  let goingHardCount = 0;
  let soonest: { address: string; date: string; days: number } | null = null;
  for (const d of deals) {
    if (!d.emd_hard_date) continue;
    const days = daysUntil(d.emd_hard_date);
    const amt = d.emd_amount ?? 0;
    if (days <= 0) {
      exposureHardNow += amt;
    } else if (days <= 10) {
      goingHardSum += amt;
      goingHardCount++;
      if (!soonest || days < soonest.days) soonest = { address: d.property_address, date: d.emd_hard_date, days };
    }
  }

  // App-wide pending count for the footer.
  const { count: awaitingReviewCount } = await admin
    .from("deal_updates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const totalActivity = dealSections.reduce(
    (n, d) => n + d.waitingOn.length + d.autoApplied.length + d.pending.length,
    0,
  );

  // Friday → Week in Review; Sunday → Week Ahead (ET weekday of the run).
  let weekInReview: DigestData["weekInReview"];
  let weekAhead: DigestData["weekAhead"];

  if ((weekday === "Friday" || forceSection === "week_in_review" || forceSection === "both") && dealIds.length) {
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const addrOf = (id: string) => deals.find((d) => d.id === id)?.property_address ?? "—";
    const completed = updates
      .filter((u) => (u.status === "approved" || u.status === "cleared") && u.reviewed_at && u.reviewed_at >= weekAgo)
      .map((u) => `${addrOf(u.deal_id)} — ${u.summary}`)
      .slice(0, 25);
    const stillPending = updates
      .filter((u) => u.status === "pending")
      .map((u) => `${addrOf(u.deal_id)} — ${u.summary}`)
      .slice(0, 25);
    weekInReview = { completed, stillPending };
  }

  if (weekday === "Sunday" || forceSection === "week_ahead" || forceSection === "both") {
    const in7 = new Date(now.getTime() + 7 * 86_400_000);
    const horizon = in7.toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const items: { date: string; text: string }[] = [];
    for (const d of deals) {
      if (d.emd_hard_date && d.emd_hard_date >= today && d.emd_hard_date <= horizon) {
        items.push({ date: d.emd_hard_date, text: `${d.emd_hard_date} · EMD hard — ${d.property_address}` });
      }
    }
    if (dealIds.length) {
      const { data: ms } = await admin
        .from("deal_milestones")
        .select("deal_id, label, target_date")
        .in("deal_id", dealIds)
        .gte("target_date", today)
        .lte("target_date", horizon);
      for (const m of (ms ?? []) as { deal_id: string; label: string; target_date: string }[]) {
        const addr = deals.find((d) => d.id === m.deal_id)?.property_address ?? "—";
        items.push({ date: m.target_date, text: `${m.target_date} · ${m.label} — ${addr}` });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    weekAhead = items.map((i) => i.text);
  }

  const data: DigestData = {
    dateLabel,
    weekday,
    exposureHardNow,
    goingHardCount,
    goingHardSum,
    goingHardSoonest: soonest ? `${soonest.address} (${soonest.date})` : null,
    deals: dealSections,
    awaitingReviewCount: awaitingReviewCount ?? 0,
    quiet: totalActivity === 0,
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, ""),
    weekInReview,
    weekAhead,
  };

  const pdf = await renderDigestPdf(data);

  // Email the attachment. Sends every night, quiet or not.
  const key = process.env.RESEND_API_KEY;
  let emailed = false;
  if (key) {
    try {
      const resend = new Resend(key);
      const { error } = await resend.emails.send({
        from: FROM,
        to: TO,
        replyTo: REPLY_TO,
        subject: `Nightly Overview — ${dateLabel}`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0a0a0a;line-height:1.5">
          <p>Attached: the Nightly Overview for ${weekday}, ${dateLabel}.</p>
          <p style="color:#6e6e73">${data.quiet ? "All quiet — no changes today." : `${data.awaitingReviewCount} item(s) awaiting review.`}</p>
        </div>`,
        attachments: [{ filename: `nightly-overview-${now.toISOString().slice(0, 10)}.pdf`, content: pdf }],
      });
      if (error) console.error("digest email failed:", error.message);
      else emailed = true;
    } catch (e) {
      console.error("digest email threw:", (e as Error).message);
    }
  } else {
    console.warn("RESEND_API_KEY missing — digest PDF generated but not emailed.");
  }

  // Advance the "since last digest" window only after a successful build.
  await admin.from("digest_state").update({ last_digest_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", 1);

  return NextResponse.json({
    ok: true,
    emailed,
    escrowDeals: deals.length,
    quiet: data.quiet,
    awaitingReview: data.awaitingReviewCount,
    weekInReview: !!weekInReview,
    weekAhead: !!weekAhead,
  });
}
