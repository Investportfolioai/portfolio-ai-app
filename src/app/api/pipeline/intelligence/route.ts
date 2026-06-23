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
  portfolio_ai_fee: number | null;
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
      "id, property_address, status, escrow_date, created_at, purchase_price, cashback_at_close, portfolio_ai_fee, seller_note_amount, acquisition_grade, stabilization_grade, intentional_pass",
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

  // Portfolio AI fees: escrow deals only (the ones actually closing) — 10% of cashback.
  const total_projected_fees = deals
    .filter(isEscrow)
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

  // Projected cashback: pending + escrow deals (not yet closed or dead).
  const total_projected_cashback = deals
    .filter((d) => (isPending(d) || isEscrow(d)) && d.cashback_at_close != null)
    .reduce((s, d) => s + (d.cashback_at_close ?? 0), 0);

  const avg_acq_grade = avg(
    deals.filter(isPending).map((d) => d.acquisition_grade).filter((g): g is number => g != null),
  );
  const avg_stab_grade = avg(
    deals.filter(isPending).map((d) => d.stabilization_grade).filter((g): g is number => g != null),
  );

  // Close rate = closed ÷ (closed + passed). Dead deals are excluded entirely —
  // they were abandoned before real evaluation, not lost after a decision point.
  const eligibleClosed = deals.filter((d) => d.status === "closed").length;
  const eligiblePassed = deals.filter((d) => d.status === "passed").length;
  const eligibleTotal = eligibleClosed + eligiblePassed;
  const close_rate = eligibleTotal === 0 ? 100 : (eligibleClosed / eligibleTotal) * 100;
  const closedCount = eligibleClosed;
  const resolvedCount = eligibleTotal;

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

  const sumField = (rows: DealRow[], key: keyof DealRow) =>
    rows.reduce((s, d) => s + (Number(d[key]) || 0), 0);

  const escrowRows = deals.filter(isEscrow);
  const pendingRows = deals.filter(isPending);

  const escrow_cashback = sumField(escrowRows, "cashback_at_close");
  const escrow_fees = sumField(escrowRows, "portfolio_ai_fee");
  const pending_cashback = sumField(pendingRows, "cashback_at_close");
  const pending_fees = sumField(pendingRows, "portfolio_ai_fee");

  return NextResponse.json({
    total_projected_fees,
    total_projected_cashback,
    avg_acq_grade,
    avg_stab_grade,
    close_rate,
    closed_count: closedCount,
    resolved_count: resolvedCount,
    avg_days_to_escrow,
    buybox_score,
    deals_in_escrow: escrow_deals.length,
    deals_pending: pending_deals.length,
    escrow_deals,
    pending_deals,
    pending_missing_cashback,
    escrow_count: escrowRows.length,
    escrow_cashback,
    escrow_fees,
    pending_count: pendingRows.length,
    pending_cashback,
    pending_fees,
  });
}
