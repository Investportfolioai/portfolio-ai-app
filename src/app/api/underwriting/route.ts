import { NextResponse } from "next/server";
import { calculateMorbyWaterfall, calculateCashflow } from "@/lib/waterfall";
import type { WaterfallInput, CashflowInput } from "@/lib/types";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pp = body.purchase_price as number | null;
  if (!pp) {
    return NextResponse.json({ error: "purchase_price required" }, { status: 400 });
  }

  const waterfallInput: WaterfallInput = {
    purchase_price: pp,
    ltv_percent: body.ltv_percent as number | null,
    seller_note_amount: body.seller_note_amount as number | null,
    assignment_fee: body.assignment_fee as number | null,
    realtor_commission: body.realtor_commission as number | null,
    insurance_annual: body.insurance_annual as number | null,
    taxes_annual: body.taxes_annual as number | null,
  };

  const waterfall = calculateMorbyWaterfall(waterfallInput);

  let cashflow = null;
  const monthlyRent = body.monthly_rent as number | null;
  if (monthlyRent) {
    const cashflowInput: CashflowInput = {
      purchase_price: pp,
      insurance_annual: body.insurance_annual as number | null,
      taxes_annual: body.taxes_annual as number | null,
      hoa_monthly: body.hoa_monthly as number | null,
      first_lien_monthly: body.first_lien_monthly as number | null,
      seller_carry_monthly: body.seller_carry_monthly as number | null,
    };
    cashflow = calculateCashflow(cashflowInput, monthlyRent);
  }

  return NextResponse.json({ waterfall, cashflow });
}
