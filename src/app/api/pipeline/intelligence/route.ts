import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { portfolioAiFee } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

interface DealRow {
  id: string;
  property_address: string;
  status: string;
  escrow_date: string | null;
  created_at: string;
  purchase_price: number | null;
  cashback_at_close: number | null;
  seller_note_amount: number | null;
  acquisition_grade: number | null;
  stabilization_grade: number | null;
  intentional_pass: boolean | null;
}

const avg = (nums: number[]): number | null =>
  nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, property_address, status, escrow_date, created_at, purchase_price, cashback_at_close, seller_note_amount, acquisition_grade, stabilization_grade, intentional_pass",
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const deals = (data ?? []) as DealRow[];

  // Diagnostic log — visible in Vercel function logs.
  console.log(
    "[intelligence] raw deals sample:",
    deals.slice(0, 20).map((d) => ({
      id: d.id,
      status: d.status,
      cashback_at_close: d.cashback_at_close,
      address: d.property_address,
    })),
  );

  const isEscrow = (d: DealRow) => d.status === "active" && !!d.escrow_date;
  const isPending = (d: DealRow) => d.status === "pending";
  const activeOrPending = (d: DealRow) => d.status === "active" || d.status === "pending";

  // Portfolio AI fees: escrow + pending deals, 10% of cashback at close.
  const total_projected_fees = deals
    .filter((d) => isEscrow(d) || isPending(d))
    .reduce(
      (s, d) =>
        s +
        (portfolioAiFee({
          cashback_at_close: d.cashback_at_close,
          purchase_price: d.purchase_price,
          seller_carry_amount: d.seller_note_amount,
        }) ?? 0),
      0,
    );

  const total_projected_cashback = deals
    .filter((d) => activeOrPending(d) && d.cashback_at_close != null)
    .reduce((s, d) => s + (d.cashback_at_close ?? 0), 0);

  const avg_acq_grade = avg(
    deals.filter(activeOrPending).map((d) => d.acquisition_grade).filter((g): g is number => g != null),
  );
  const avg_stab_grade = avg(
    deals.filter(activeOrPending).map((d) => d.stabilization_grade).filter((g): g is number => g != null),
  );

  const closedCount = deals.filter((d) => d.escrow_date != null).length;
  const workedCount = deals.filter((d) => d.status !== "dead" && d.intentional_pass !== true).length;
  const close_rate = workedCount > 0 ? (closedCount / workedCount) * 100 : 0;

  const avg_days_to_escrow = avg(
    deals
      .filter((d) => d.escrow_date != null)
      .map((d) => (new Date(d.escrow_date as string).getTime() - new Date(d.created_at).getTime()) / DAY_MS)
      .filter((n) => Number.isFinite(n) && n >= 0),
  );

  const buybox_score = avg(
    deals
      .filter((d) => d.escrow_date != null && d.cashback_at_close != null && d.purchase_price)
      .map((d) => (d.cashback_at_close! / d.purchase_price!) * 100),
  );

  const escrow_deals = deals
    .filter(isEscrow)
    .map((d) => ({
      id: d.id,
      property_address: d.property_address,
      escrow_date: d.escrow_date,
      purchase_price: d.purchase_price,
      cashback_at_close: d.cashback_at_close,
      acquisition_grade: d.acquisition_grade,
    }));

  const pending_deals = deals
    .filter(isPending)
    .map((d) => ({
      id: d.id,
      property_address: d.property_address,
      created_at: d.created_at,
      purchase_price: d.purchase_price,
      acquisition_grade: d.acquisition_grade,
      stabilization_grade: d.stabilization_grade,
      cashback_at_close: d.cashback_at_close,
    }));

  const pending_missing_cashback = deals.filter(
    (d) => isPending(d) && d.cashback_at_close == null,
  ).length;

  return NextResponse.json({
    total_projected_fees,
    total_projected_cashback,
    avg_acq_grade,
    avg_stab_grade,
    close_rate,
    closed_count: closedCount,
    worked_count: workedCount,
    avg_days_to_escrow,
    buybox_score,
    deals_in_escrow: escrow_deals.length,
    deals_pending: pending_deals.length,
    escrow_deals,
    pending_deals,
    pending_missing_cashback,
  });
}
