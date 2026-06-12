import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { fireWebhookById } from "@/lib/webhooks";

export const runtime = "nodejs";

/**
 * POST { deal_id } — move a deal into escrow: stamp escrow_date and mark it
 * active so it surfaces on the Escrow Pipeline (status = active AND escrow_date).
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { deal_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.deal_id) return NextResponse.json({ error: "Missing deal_id" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("deals")
    .update({ escrow_date: new Date().toISOString(), status: "active" })
    .eq("id", body.deal_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  fireWebhookById("deal.escrow", body.deal_id);
  return NextResponse.json({ ok: true });
}

/** PATCH { deal_id, cashback_at_close } — update the cashback amount. */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { deal_id?: string; cashback_at_close?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.deal_id) return NextResponse.json({ error: "Missing deal_id" }, { status: 400 });

  const raw = body.cashback_at_close;
  const cashback =
    raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (cashback !== null && !Number.isFinite(cashback)) {
    return NextResponse.json({ error: "Invalid cashback value" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("deals")
    .update({ cashback_at_close: cashback })
    .eq("id", body.deal_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
