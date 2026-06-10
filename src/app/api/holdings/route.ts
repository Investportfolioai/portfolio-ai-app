import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { netCashflow } from "@/lib/cashflow";
import { getZillowAVM } from "@/lib/zillow";
import { getBalloonStatus } from "@/lib/balloon";

export const runtime = "nodejs";
export const maxDuration = 60;

// Manual-override field coercion for PATCH ?id=.
const NUMERIC = new Set([
  "purchase_price", "mortgage_balance", "monthly_payment", "seller_carry_balance",
  "seller_carry_payment", "purchase_close_price", "zillow_avm",
]);
const ALLOWED = new Set([
  "address", "property_type", "purchase_price", "acquisition_date", "mortgage_balance",
  "monthly_payment", "notes", "balloon_date", "balloon_notes", "extension_clause",
  "seller_carry_balance", "seller_carry_payment", "seller_carry_maturity",
  "purchase_close_price", "important_notes", "lease_end_date", "tenant_name",
]);

/**
 * GET — holdings enriched with balloon_status, financials (+net_cashflow),
 * documents, and the last 12 weeks of AVM snapshots. New tables degrade to
 * empty if the Phase-3 migration hasn't been applied yet.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { data: holdings, error } = await admin
      .from("holdings")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const ids = (holdings ?? []).map((h) => h.id);
    const finBy: Record<string, Record<string, unknown>> = {};
    const docsBy: Record<string, unknown[]> = {};
    const snapsBy: Record<string, unknown[]> = {};

    if (ids.length) {
      const { data: fins } = await admin.from("holding_financials").select("*").in("holding_id", ids);
      for (const f of fins ?? []) finBy[f.holding_id as string] = f;

      const { data: docs } = await admin
        .from("holding_documents").select("*").in("holding_id", ids)
        .order("created_at", { ascending: false });
      for (const d of docs ?? []) (docsBy[d.holding_id as string] ??= []).push(d);

      const cutoff = new Date(Date.now() - 84 * 86_400_000).toISOString().slice(0, 10);
      const { data: snaps } = await admin
        .from("holding_snapshots").select("*").in("holding_id", ids)
        .gte("snapshot_date", cutoff).order("snapshot_date", { ascending: true });
      for (const s of snaps ?? []) (snapsBy[s.holding_id as string] ??= []).push(s);
    }

    const enriched = (holdings ?? []).map((h) => ({
      ...h,
      balloon_status: getBalloonStatus(h.balloon_date ?? null),
      financials: finBy[h.id] ?? null,
      net_cashflow: netCashflow(finBy[h.id]),
      documents: docsBy[h.id] ?? [],
      snapshots: snapsBy[h.id] ?? [],
    }));

    return NextResponse.json({ holdings: enriched });
  } catch (err) {
    console.error("[holdings] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error", holdings: [] },
      { status: 500 },
    );
  }
}

/**
 * PATCH ?id=<id>            — manual override of holding fields (drawer edits).
 * PATCH ?id=<id>&action=refresh — refresh the Zillow AVM (~30s).
 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const admin = createAdminClient();

  // AVM refresh action.
  if (url.searchParams.get("action") === "refresh") {
    const { data: h, error: fErr } = await admin.from("holdings").select("address").eq("id", id).maybeSingle();
    if (fErr || !h) return NextResponse.json({ error: "Holding not found" }, { status: 404 });
    const avm = await getZillowAVM(h.address);
    if (avm == null) return NextResponse.json({ ok: false, error: "Couldn't fetch a Zillow estimate." });
    const stamp = new Date().toISOString();
    const { error } = await admin.from("holdings").update({ zillow_avm: avm, zillow_last_pulled: stamp }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, zillow_avm: avm, zillow_last_pulled: stamp });
  }

  // Manual field override.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) continue;
    if (v === "" || v === null || v === undefined) {
      patch[k] = null;
    } else if (NUMERIC.has(k)) {
      const n = Number(v);
      patch[k] = Number.isFinite(n) ? n : null;
    } else {
      patch[k] = String(v);
    }
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { data, error } = await admin.from("holdings").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, holding: data });
}

/** POST — create a holding; returns celebration data (equity established). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const address = String(body.address ?? "").trim();
  if (!address) return NextResponse.json({ error: "Address is required." }, { status: 400 });

  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const purchasePrice = num(body.purchase_price);
  const closePrice = num(body.purchase_close_price) ?? purchasePrice;
  const mortgage = num(body.mortgage_balance);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("holdings")
    .insert({
      owner_id: user.id,
      address,
      property_type: String(body.property_type ?? "").trim() || null,
      purchase_price: purchasePrice,
      purchase_close_price: closePrice,
      acquisition_date: body.acquisition_date ? String(body.acquisition_date) : null,
      mortgage_balance: mortgage,
      monthly_payment: num(body.monthly_payment),
      notes: String(body.notes ?? "").trim() || null,
    })
    .select("id, zillow_avm")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Celebration: equity from best-known value (AVM not yet pulled at create → close/purchase price).
  const base = num(data?.zillow_avm) ?? closePrice ?? purchasePrice;
  const equity_added = base != null && mortgage != null ? base - mortgage : (base ?? 0);

  return NextResponse.json({
    ok: true,
    id: data?.id,
    equity_added,
    fits_buybox: equity_added > 0,
  });
}

/** DELETE — remove a holding by ?id=. */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from("holdings").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
