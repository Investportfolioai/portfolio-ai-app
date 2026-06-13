import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Range = "this_week" | "this_month" | "all_time";

function rangeStart(range: Range): string | null {
  const now = new Date();
  if (range === "this_week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay()); // start of week (Sunday)
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (range === "this_month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  return null;
}

// Build 12-week trend buckets (week number → values).
function weekKey(iso: string): string {
  const d = new Date(iso);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + jan1.getDay() + 1) / 7);
  return `W${String(week).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const range = (url.searchParams.get("range") ?? "all_time") as Range;
  const cutoff = rangeStart(range);

  const admin = createAdminClient();

  // ── Closed deals in range ──────────────────────────────────────────────────
  let closedQ = admin
    .from("deals")
    .select(
      "id, cashback_at_close, assignment_fee, portfolio_ai_fee, credit_partner_fee, tl_fee, submitter_email, property_address, closed_at, rental_strategy, purchase_price, structure_type",
    )
    .eq("status", "closed");
  if (cutoff) closedQ = closedQ.gte("closed_at", cutoff);
  const { data: closedDeals } = await closedQ;
  const closed = closedDeals ?? [];

  // ── All-time closed for comparison (growth %) ──────────────────────────────
  let prevCutoff: string | null = null;
  if (range === "this_week") {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() - 7);
    d.setHours(0, 0, 0, 0);
    prevCutoff = d.toISOString();
  } else if (range === "this_month") {
    const now = new Date();
    prevCutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  }

  let prevCount = 0;
  if (prevCutoff && cutoff) {
    const { count: pc } = await admin
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("status", "closed")
      .gte("closed_at", prevCutoff)
      .lt("closed_at", cutoff);
    prevCount = pc ?? 0;
  }

  const sum = (arr: typeof closed, key: keyof (typeof closed)[0]) =>
    arr.reduce((a, r) => a + (Number(r[key]) || 0), 0);

  const dealsClosed = closed.length;
  const totalCashback = sum(closed, "cashback_at_close");
  const totalFees =
    sum(closed, "portfolio_ai_fee") +
    sum(closed, "credit_partner_fee") +
    sum(closed, "tl_fee");
  const sellersHelped = new Set(closed.map((d) => d.property_address).filter(Boolean)).size;

  const growth = prevCount > 0
    ? Math.round(((dealsClosed - prevCount) / prevCount) * 100)
    : null;

  // ── Top wholesalers ────────────────────────────────────────────────────────
  const wMap = new Map<string, { deals: number; volume: number; fees: number; sellers: Set<string> }>();
  for (const d of closed) {
    const email = d.submitter_email?.trim().toLowerCase();
    if (!email) continue;
    const cur = wMap.get(email) ?? { deals: 0, volume: 0, fees: 0, sellers: new Set() };
    cur.deals += 1;
    cur.volume += Number(d.purchase_price) || 0;
    cur.fees += (Number(d.portfolio_ai_fee) || 0) + (Number(d.credit_partner_fee) || 0);
    if (d.property_address) cur.sellers.add(d.property_address);
    wMap.set(email, cur);
  }
  const topWholesalers = [...wMap.entries()]
    .map(([email, v]) => ({ email, deals: v.deals, volume: v.volume, fees: v.fees, sellers: v.sellers.size }))
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 5);
  const maxDeals = topWholesalers[0]?.deals ?? 1;

  // ── 12-week trend ──────────────────────────────────────────────────────────
  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000).toISOString();
  const { data: trendDeals } = await admin
    .from("deals")
    .select("closed_at, cashback_at_close, portfolio_ai_fee, credit_partner_fee, tl_fee")
    .eq("status", "closed")
    .gte("closed_at", twelveWeeksAgo);

  const trendMap = new Map<string, { deals: number; volume: number; fees: number }>();
  for (const d of trendDeals ?? []) {
    if (!d.closed_at) continue;
    const k = weekKey(d.closed_at);
    const cur = trendMap.get(k) ?? { deals: 0, volume: 0, fees: 0 };
    cur.deals += 1;
    cur.volume += Number(d.cashback_at_close) || 0;
    cur.fees += (Number(d.portfolio_ai_fee) || 0) + (Number(d.credit_partner_fee) || 0) + (Number(d.tl_fee) || 0);
    trendMap.set(k, cur);
  }
  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, v]) => ({ week, ...v }));

  // ── Deal mix (rental_strategy breakdown) ──────────────────────────────────
  const mixMap = new Map<string, number>();
  for (const d of closed) {
    const t = d.rental_strategy ?? d.structure_type ?? "other";
    mixMap.set(t, (mixMap.get(t) ?? 0) + 1);
  }
  const dealMix = [...mixMap.entries()].map(([type, count]) => ({
    type,
    count,
    pct: dealsClosed > 0 ? Math.round((count / dealsClosed) * 100) : 0,
  })).sort((a, b) => b.count - a.count);

  // ── Live activity ──────────────────────────────────────────────────────────
  const { data: activityRows } = await admin
    .from("deal_activity")
    .select("id, action, note, created_at, deal:deal_id(property_address, cashback_at_close)")
    .order("created_at", { ascending: false })
    .limit(10);

  const activity = ((activityRows ?? []) as unknown as {
    id: string;
    action: string;
    note: string | null;
    created_at: string;
    deal: { property_address: string; cashback_at_close: number | null } | null;
  }[]).map((a) => ({
    id: a.id,
    action: a.action,
    note: a.note,
    created_at: a.created_at,
    address: a.deal?.property_address ?? null,
    cashback: a.deal?.cashback_at_close ?? null,
  }));

  return NextResponse.json({
    range,
    dealsClosed,
    totalCashback,
    totalFees,
    sellersHelped,
    growth,
    topWholesalers,
    maxDeals,
    trend,
    dealMix,
    activity,
  });
}
