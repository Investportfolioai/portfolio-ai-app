import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManagePortfolio } from "@/lib/permissions";
import { netCashflow } from "@/lib/cashflow";

export const runtime = "nodejs";

const FIELDS = [
  "income_rent",
  "income_other",
  "outflow_mortgage",
  "outflow_seller_carry",
  "outflow_taxes",
  "outflow_hoa",
  "outflow_other",
] as const;

type FinRow = Record<(typeof FIELDS)[number], number | null> & { id: string; holding_id: string };

async function getOrCreate(admin: ReturnType<typeof createAdminClient>, holdingId: string) {
  const { data } = await admin.from("holding_financials").select("*").eq("holding_id", holdingId).maybeSingle();
  if (data) return data as FinRow;
  const { data: created } = await admin
    .from("holding_financials")
    .insert({ holding_id: holdingId })
    .select("*")
    .single();
  return created as FinRow;
}

/** GET ?holding_id= — financials row (auto-created if missing) + net_cashflow. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManagePortfolio(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const holdingId = new URL(req.url).searchParams.get("holding_id");
  if (!holdingId) return NextResponse.json({ error: "Missing holding_id" }, { status: 400 });

  const admin = createAdminClient();
  const financials = await getOrCreate(admin, holdingId);
  return NextResponse.json({ financials, net_cashflow: netCashflow(financials ?? {}) });
}

/** PATCH { holding_id, ...fields } — update financial fields, return recalced net. */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManagePortfolio(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const holdingId = String(body.holding_id ?? "");
  if (!holdingId) return NextResponse.json({ error: "Missing holding_id" }, { status: 400 });

  const admin = createAdminClient();
  await getOrCreate(admin, holdingId);

  const patch: Record<string, number> = {};
  for (const f of FIELDS) {
    if (f in body) {
      const v = Number(body[f]);
      patch[f] = Number.isFinite(v) ? v : 0;
    }
  }

  const { data, error } = await admin
    .from("holding_financials")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("holding_id", holdingId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ financials: data, net_cashflow: netCashflow(data ?? {}) });
}
