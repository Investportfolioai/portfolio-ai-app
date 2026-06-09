import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { getZillowAVM } from "@/lib/zillow";

export const runtime = "nodejs";
export const maxDuration = 60;

function canManage(role: string | null): boolean {
  return role === "owner" || role === "partner";
}

/**
 * GET — return the firm's holdings immediately from the DB (no Zillow call).
 * AVMs are refreshed on demand per card via PATCH, not on page load.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("holdings")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ holdings: data ?? [] });
}

/**
 * PATCH { id } — refresh a single holding's Zillow AVM (the ~30s async lookup
 * happens here, triggered by the per-card refresh button). Persists and returns
 * the new value on success; leaves the stored value untouched on a miss.
 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: holding, error: fErr } = await admin
    .from("holdings")
    .select("address")
    .eq("id", body.id)
    .maybeSingle();
  if (fErr || !holding) return NextResponse.json({ error: "Holding not found" }, { status: 404 });

  const avm = await getZillowAVM(holding.address);
  if (avm == null) {
    return NextResponse.json({ ok: false, error: "Couldn't fetch a Zillow estimate." });
  }

  const stamp = new Date().toISOString();
  const { error } = await admin
    .from("holdings")
    .update({ zillow_avm: avm, zillow_last_pulled: stamp })
    .eq("id", body.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, zillow_avm: avm, zillow_last_pulled: stamp });
}

/** POST — create a holding owned by the authenticated user. */
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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("holdings")
    .insert({
      owner_id: user.id,
      address,
      property_type: String(body.property_type ?? "").trim() || null,
      purchase_price: num(body.purchase_price),
      acquisition_date: body.acquisition_date ? String(body.acquisition_date) : null,
      mortgage_balance: num(body.mortgage_balance),
      monthly_payment: num(body.monthly_payment),
      notes: String(body.notes ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id });
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
