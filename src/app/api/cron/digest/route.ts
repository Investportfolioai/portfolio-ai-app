import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { daysUntil, EMD_EVENT_LABELS, EXPECTED_ITEM_OWNER_LABELS, EXPECTED_ITEM_STATUS_LABELS } from "@/lib/types";
import type { EmdEventType, ExpectedItemOwner, ExpectedItemStatus } from "@/lib/types";
import { money } from "@/lib/format";
import {
  renderDigestPdf,
  type DigestData,
  type DigestDealSection,
  type DigestActivityEntry,
  type DigestAppraisalSummary,
  type DigestLendingSummary,
  type DigestOutstandingItem,
  type DigestPofEntityGroup,
} from "@/lib/digest-pdf";
import { backfillExpectedItems, POF_PCT } from "@/lib/deal-ledger";
import { LENDING_STAGES, computeAutoStage } from "@/lib/lending-seed";

export const runtime = "nodejs";
export const maxDuration = 60;

const FROM = "Portfolio AI <deals@mail.investportfolio.ai>";
const TO = ["john@investportfolio.ai", "dani@investportfolio.ai", "loa@investportfolio.ai"];
const REPLY_TO = ["john@investportfolio.ai", "loa@investportfolio.ai"];

const STALE_THRESHOLD_DAYS = 14;

interface EscrowDeal {
  id: string;
  property_address: string;
  stage: string | null;
  stage_override: string | null;
  status_changed_at: string | null;
  escrow_date: string | null;
  emd_hard_date: string | null;
  emd_amount: number | null;
  emd_received_at: string | null;
  appraisal_received_at: string | null;
  appraised_value: number | null;
  appraisal_conditions: string[] | null;
  entity_name: string | null;
}

interface UpdateRow {
  deal_id: string;
  event_type: string;
  summary: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

interface EmdEventRow {
  deal_id: string;
  event_type: string;
  detail: string | null;
  created_at: string;
}

interface LedgerRow {
  id: string;
  deal_id: string;
  item_key: string;
  label: string;
  owner_party: ExpectedItemOwner;
  status: ExpectedItemStatus;
  requested_at: string | null;
  received_at: string | null;
  cleared_at: string | null;
  created_at: string;
}

interface ChecklistRow {
  deal_id: string;
  stage: string;
  completed: boolean;
  item_text: string;
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

function emdReceivedFor(deal: EscrowDeal): { label: string; bad: boolean } | null {
  if (deal.emd_amount == null) return null;
  return deal.emd_received_at
    ? { label: `RECEIVED ${deal.emd_received_at.slice(0, 10)}`, bad: false }
    : { label: "NOT RECEIVED", bad: true };
}

/**
 * Lending checklist stage + progress (Section 4). stage_override (constrained
 * to the 7 lending stages, migration 20260617000001) wins when set, exactly
 * mirroring the Lending detail page's own effectiveStage — the digest and the
 * Lending tab must never disagree on "current stage."
 */
function lendingSummaryFor(deal: EscrowDeal, checklist: ChecklistRow[]): DigestLendingSummary {
  const byStage = new Map<string, { completed: boolean }[]>();
  for (const stage of LENDING_STAGES) byStage.set(stage, []);
  for (const c of checklist) (byStage.get(c.stage) ?? []).push({ completed: c.completed });
  const stage = deal.stage_override ?? computeAutoStage(byStage, LENDING_STAGES);
  const done = checklist.filter((c) => c.completed).length;
  const total = checklist.length;
  const missing = checklist.filter((c) => !c.completed).map((c) => c.item_text).slice(0, 5);
  return { stageLabel: titleize(stage), done, total, missing };
}

/**
 * NEXT UP — the single most blocking item (Section 4), in priority order:
 * unreceived EMD (amount set) > oldest outstanding 'requested' ledger item >
 * earliest still-'expected' item > falls back to the lending stage itself.
 */
function computeNextUp(deal: EscrowDeal, ledger: LedgerRow[], lendingStageLabel: string): string {
  if (deal.emd_amount != null && !deal.emd_received_at) {
    return `EMD not received (${money(deal.emd_amount)})`;
  }

  const requested = ledger
    .filter((i) => i.status === "requested")
    .sort((a, b) => (a.requested_at ?? a.created_at).localeCompare(b.requested_at ?? b.created_at));
  if (requested.length) {
    const item = requested[0];
    const since = (item.requested_at ?? item.created_at).slice(0, 10);
    return `Requested: ${item.label} (since ${since})`;
  }

  const expected = ledger.filter((i) => i.status === "expected").sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (expected.length) {
    return `Expected: ${expected[0].label}`;
  }

  return `Awaiting ${lendingStageLabel}`;
}

/**
 * Up to 3 most recent events (deal_updates ∪ emd_events), however old, plus a
 * STALE flag when the most recent is 14+ days back. Pending deal_updates are
 * excluded — they're not "activity" yet, and already surface via "Needs a tap."
 */
function latestActivityFor(
  updates: UpdateRow[],
  emdEvents: EmdEventRow[],
  fallbackSinceIso: string | null,
  now: Date,
): { latestActivity: DigestActivityEntry[]; stale: string | null } {
  const candidates: { date: string; text: string }[] = [];
  for (const u of updates) {
    if (u.status === "pending") continue;
    candidates.push({ date: u.created_at, text: u.summary });
  }
  for (const e of emdEvents) {
    const label = EMD_EVENT_LABELS[e.event_type as EmdEventType] ?? titleize(e.event_type);
    candidates.push({ date: e.created_at, text: e.detail ? `${label}: ${e.detail}` : label });
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date));

  const latestActivity = candidates.slice(0, 3).map((c) => ({ date: c.date.slice(0, 10), text: c.text }));
  const mostRecentIso = candidates[0]?.date ?? fallbackSinceIso;
  let stale: string | null = null;
  if (mostRecentIso) {
    const daysSince = Math.floor((now.getTime() - new Date(mostRecentIso).getTime()) / 86_400_000);
    if (daysSince >= STALE_THRESHOLD_DAYS) stale = `STALE: no activity since ${mostRecentIso.slice(0, 10)}`;
  }
  return { latestActivity, stale };
}

function appraisalSummaryFor(deal: EscrowDeal, ledger: LedgerRow[]): DigestAppraisalSummary {
  const appraisalItem = ledger.find((i) => i.item_key === "appraisal_report");
  const pofItem = ledger.find((i) => i.item_key === "pof_submission");

  let status: DigestAppraisalSummary["status"];
  let valueLabel: string | null = null;
  let conditions: string[] = [];

  if (deal.appraised_value != null) {
    conditions = deal.appraisal_conditions ?? [];
    valueLabel = money(deal.appraised_value);
    status = conditions.length > 0 ? "back_conditions" : "back_turnkey";
  } else if (deal.appraisal_received_at) {
    status = "back_pending_extraction";
  } else if (appraisalItem?.status === "requested") {
    status = "ordered_waiting";
  } else {
    status = "not_ordered";
  }

  let pofDueLabel: string | null = null;
  if (deal.appraised_value != null && pofItem && pofItem.status !== "cleared" && pofItem.status !== "waived") {
    pofDueLabel = `POF DUE: ${money(Math.round(deal.appraised_value * POF_PCT))} (32%)`;
  }

  return { status, valueLabel, conditions, pofDueLabel };
}

function outstandingFor(ledger: LedgerRow[]): DigestOutstandingItem[] {
  return ledger
    .filter((i) => i.status === "expected" || i.status === "requested")
    .map((i) => ({
      label: i.label,
      owner: EXPECTED_ITEM_OWNER_LABELS[i.owner_party],
      status: EXPECTED_ITEM_STATUS_LABELS[i.status],
      since: (i.requested_at ?? i.created_at)?.slice(0, 10) ?? null,
    }));
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Seed the expected-item ledger for every active escrow deal before reading
  // anything else — idempotent (upsert-do-nothing on the deal_id/item_key
  // unique key), so this is safe to run every night ahead of the digest build.
  const ledgerBackfill = await backfillExpectedItems(admin);

  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(now);
  // CRON_SECRET-guarded test override (the whole route already requires the
  // bearer token — see isAuthorizedCron above — so this param is unreachable
  // without it): ?section=week_in_review | week_ahead | both forces the
  // weekly sections on any day. Kept past the original "temporary" label
  // (Automation Push) because Section 5's live-test pass still wants it to
  // force Friday/Sunday sections on demand; safe to strip once that's done.
  const forceSection = new URL(req.url).searchParams.get("section");

  const { data: stateRow } = await admin.from("digest_state").select("last_digest_at").eq("id", 1).maybeSingle();
  const lastDigestAt = stateRow?.last_digest_at ?? new Date(now.getTime() - 86_400_000).toISOString();

  // Escrow deals = active with an escrow date set.
  const { data: dealRows } = await admin
    .from("deals")
    .select(
      "id, property_address, stage, stage_override, status_changed_at, escrow_date, emd_hard_date, emd_amount, emd_received_at, appraisal_received_at, appraised_value, appraisal_conditions, entity_name",
    )
    .eq("status", "active")
    .not("escrow_date", "is", null)
    .order("emd_hard_date", { ascending: true, nullsFirst: false });
  const deals = (dealRows ?? []) as EscrowDeal[];
  const dealIds = deals.map((d) => d.id);

  const [updatesRes, emdEventsRes, ledgerRes, checklistRes] = await Promise.all([
    dealIds.length
      ? admin.from("deal_updates").select("deal_id, event_type, summary, status, created_at, reviewed_at").in("deal_id", dealIds)
      : Promise.resolve({ data: [] }),
    dealIds.length
      ? admin.from("emd_events").select("deal_id, event_type, detail, created_at").in("deal_id", dealIds)
      : Promise.resolve({ data: [] }),
    dealIds.length
      ? admin
          .from("deal_expected_items")
          .select("id, deal_id, item_key, label, owner_party, status, requested_at, received_at, cleared_at, created_at")
          .in("deal_id", dealIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    dealIds.length
      ? admin.from("lending_checklist_items").select("deal_id, stage, completed, item_text").in("deal_id", dealIds)
      : Promise.resolve({ data: [] }),
  ]);

  const updates = (updatesRes.data ?? []) as UpdateRow[];
  const emdEvents = (emdEventsRes.data ?? []) as EmdEventRow[];
  const ledgerRows = (ledgerRes.data ?? []) as LedgerRow[];
  const checklistRows = (checklistRes.data ?? []) as ChecklistRow[];

  const byDealArr = <T,>(rows: T[], keyOf: (r: T) => string): Record<string, T[]> => {
    const map: Record<string, T[]> = {};
    for (const r of rows) (map[keyOf(r)] ??= []).push(r);
    return map;
  };
  const updatesByDeal = byDealArr(updates, (u) => u.deal_id);
  const emdEventsByDeal = byDealArr(emdEvents, (e) => e.deal_id);
  const ledgerByDeal = byDealArr(ledgerRows, (l) => l.deal_id);
  const checklistByDeal = byDealArr(checklistRows, (c) => c.deal_id);

  const byDeal = (predicate: (u: UpdateRow) => boolean) => {
    const map: Record<string, string[]> = {};
    for (const u of updates) if (predicate(u)) (map[u.deal_id] ??= []).push(u.summary);
    return map;
  };
  const waitingByDeal = byDeal((u) => u.status === "auto" && u.event_type === "task");
  const autoByDeal = byDeal((u) => u.status === "auto" && u.event_type !== "task" && u.created_at > lastDigestAt);
  const pendingByDeal = byDeal((u) => u.status === "pending");

  const dealSections: DigestDealSection[] = deals.map((d) => {
    const ledger = ledgerByDeal[d.id] ?? [];
    const checklist = checklistByDeal[d.id] ?? [];
    const lending = lendingSummaryFor(d, checklist);
    const { latestActivity, stale } = latestActivityFor(
      updatesByDeal[d.id] ?? [],
      emdEventsByDeal[d.id] ?? [],
      d.escrow_date,
      now,
    );
    return {
      address: d.property_address,
      stageLabel: titleize(d.stage_override ?? d.stage ?? "—"),
      inEscrowDays: d.escrow_date ? daysBetween(d.escrow_date, now) : null,
      entityLabel: d.entity_name ?? "UNKNOWN",
      entityUnknown: !d.entity_name,
      nextUp: computeNextUp(d, ledger, lending.stageLabel),
      latestActivity,
      stale,
      lending,
      emdLine: emdLine(d),
      emdReceived: emdReceivedFor(d),
      appraisal: appraisalSummaryFor(d, ledger),
      outstanding: outstandingFor(ledger),
      waitingOn: waitingByDeal[d.id] ?? [],
      autoApplied: autoByDeal[d.id] ?? [],
      pending: pendingByDeal[d.id] ?? [],
    };
  });

  // POF Planning — grouped by vesting entity, across every escrow deal with a POF currently due
  // (ledger status 'requested' — set once by maybeTriggerPof, cleared once submitted/cleared).
  const pofGroups = new Map<string, { deals: { address: string; amount: number }[]; total: number }>();
  let unknownGroup: { deals: { address: string; amount: number }[]; total: number } | null = null;
  for (const d of deals) {
    if (d.appraised_value == null) continue;
    const pofItem = (ledgerByDeal[d.id] ?? []).find((i) => i.item_key === "pof_submission");
    if (!pofItem || pofItem.status !== "requested") continue;
    const amount = Math.round(d.appraised_value * POF_PCT);
    if (d.entity_name) {
      const g = pofGroups.get(d.entity_name) ?? { deals: [], total: 0 };
      g.deals.push({ address: d.property_address, amount });
      g.total += amount;
      pofGroups.set(d.entity_name, g);
    } else {
      unknownGroup ??= { deals: [], total: 0 };
      unknownGroup.deals.push({ address: d.property_address, amount });
      unknownGroup.total += amount;
    }
  }
  const pofPlanning: DigestPofEntityGroup[] = [...pofGroups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([entityName, g]) => ({ entityName, unknown: false, deals: g.deals, total: g.total }));
  if (unknownGroup) {
    pofPlanning.push({ entityName: "ENTITY UNKNOWN, assign in app", unknown: true, deals: unknownGroup.deals, total: unknownGroup.total });
  }

  // EMD exposure header.
  let exposureHardNow = 0;
  let goingHardSum = 0;
  let goingHardCount = 0;
  let soonest: { address: string; date: string; days: number } | null = null;
  const hardNowDeals: string[] = [];
  const goingHardDeals: string[] = [];
  const amtLabel = (n: number | null) => (n != null ? money(n) : "amount not set");
  for (const d of deals) {
    if (!d.emd_hard_date) continue;
    const days = daysUntil(d.emd_hard_date);
    const amt = d.emd_amount ?? 0;
    if (days <= 0) {
      exposureHardNow += amt;
      hardNowDeals.push(`${d.property_address} — ${amtLabel(d.emd_amount)} (hard ${d.emd_hard_date})`);
    } else if (days <= 10) {
      goingHardSum += amt;
      goingHardCount++;
      goingHardDeals.push(`${d.property_address} — ${amtLabel(d.emd_amount)} (${d.emd_hard_date}, ${days}d)`);
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
    hardNowDeals,
    goingHardDeals,
    deals: dealSections,
    pofPlanning,
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
    pofPlanningEntities: pofPlanning.length,
    ledgerBackfill,
  });
}
