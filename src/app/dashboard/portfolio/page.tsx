import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canManagePortfolio } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortfolioClient, type PortfolioDeal, type ChartPoint } from "./portfolio-client";
import { backfillSnapshots } from "./actions";

export const metadata = { title: "Portfolio — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canManagePortfolio(user.role)) redirect("/dashboard");

  // Backfill synthetic monthly snapshots when real data is sparse.
  // Fast-exits (one COUNT query) once ≥3 rows exist.
  await backfillSnapshots().catch((e) =>
    console.warn("[portfolio] backfill error:", e),
  );

  const admin = createAdminClient();

  // Fetch aggregated portfolio value chart data (last 13 months).
  // Done server-side so it bypasses the 84-day cutoff in /api/holdings.
  let chartData: ChartPoint[] = [];
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 13);
    const { data: snaps } = await admin
      .from("holding_snapshots")
      .select("snapshot_date, avm_value")
      .gte("snapshot_date", cutoff.toISOString().slice(0, 10))
      .order("snapshot_date", { ascending: true });

    const byDate: Record<string, number> = {};
    for (const s of snaps ?? []) {
      const d = s.snapshot_date as string;
      byDate[d] = (byDate[d] ?? 0) + ((s.avm_value as number) ?? 0);
    }
    chartData = Object.entries(byDate).map(([date, value]) => ({ date, value }));
  } catch (e) {
    console.warn("[portfolio] chart data fetch error:", e);
  }

  // cashback_at_close / escrow_date come from the Phase-3 migration; if it
  // hasn't been applied yet the select errors and both lists stay empty
  // (Holdings still works), rather than crashing the page.
  let pending: PortfolioDeal[] = [];
  let escrow: PortfolioDeal[] = [];
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, property_address, purchase_price, arv, acquisition_grade, stabilization_grade, created_at, status, cashback_at_close, escrow_date",
    )
    .in("status", ["pending", "active"])
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[portfolio] deals select failed:", error.message);
  } else {
    const rows = (data ?? []) as PortfolioDeal[];
    pending = rows.filter((d) => d.status === "pending");
    escrow = rows.filter((d) => d.status === "active" && d.escrow_date);
  }

  return <PortfolioClient pending={pending} escrow={escrow} chartData={chartData} />;
}
