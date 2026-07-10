"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManagePortfolio } from "@/lib/permissions";

/**
 * Backfill synthetic monthly snapshots for each holding so the portfolio
 * value chart has history from the earliest acquisition date rather than
 * only from when the cron started running.
 *
 * Uses the current zillow_avm as a flat baseline for all synthetic rows.
 * Real snapshots written by the cron are never touched — we pre-filter
 * against existing (holding_id, snapshot_date) pairs before inserting.
 *
 * Exits early if 3 or more snapshot rows already exist (backfill already done).
 */
export async function backfillSnapshots(): Promise<void> {
  const user = await getSessionUser();
  if (!user || !canManagePortfolio(user.role)) return;

  const admin = createAdminClient();

  // Fast exit: if enough real snapshots exist, skip entirely
  const { count } = await admin
    .from("holding_snapshots")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) >= 3) return;

  // Fetch holdings that have an AVM value to use as the baseline
  const { data: holdings, error: hErr } = await admin
    .from("holdings")
    .select("id, zillow_avm, created_at, acquisition_date")
    .not("zillow_avm", "is", null);

  if (hErr || !holdings || holdings.length === 0) return;

  // Fetch already-existing snapshot keys so we never duplicate them
  const { data: existing } = await admin
    .from("holding_snapshots")
    .select("holding_id, snapshot_date");

  const seen = new Set(
    (existing ?? []).map(
      (r: { holding_id: string; snapshot_date: string }) =>
        `${r.holding_id}:${r.snapshot_date}`,
    ),
  );

  const today = new Date();
  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const rows: Array<{
    holding_id: string;
    avm_value: number;
    snapshot_date: string;
  }> = [];

  for (const h of holdings) {
    const avm = h.zillow_avm as number;
    // Prefer acquisition_date (actual close date), fall back to created_at
    const rawDate = ((h.acquisition_date ?? h.created_at) as string | null) ?? new Date().toISOString();
    const start = new Date(rawDate);
    // Snap to first of the starting month
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

    while (cursor <= firstOfThisMonth) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const key = `${h.id as string}:${dateStr}`;
      if (!seen.has(key)) {
        rows.push({ holding_id: h.id as string, avm_value: avm, snapshot_date: dateStr });
        seen.add(key);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  if (rows.length === 0) return;

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await admin
      .from("holding_snapshots")
      .insert(rows.slice(i, i + BATCH));
    if (error) console.warn("[backfill] insert batch error:", error.message);
  }

  console.log(`[portfolio] backfilled ${rows.length} synthetic snapshot rows`);
}
