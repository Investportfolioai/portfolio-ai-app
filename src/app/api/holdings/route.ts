import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { getZillowAVM } from "@/lib/zillow";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

function canManage(role: string | null): boolean {
  return role === "owner" || role === "partner";
}

interface Holding {
  id: string;
  address: string;
  zillow_avm: number | null;
  zillow_last_pulled: string | null;
  [k: string]: unknown;
}

/**
 * GET — return the firm's holdings. For any holding whose AVM is stale (never
 * pulled or > 24h old), refresh it from Zillow and persist before returning.
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

  const holdings = (data ?? []) as Holding[];
  const now = Date.now();

  await Promise.all(
    holdings.map(async (h) => {
      const last = h.zillow_last_pulled ? new Date(h.zillow_last_pulled).getTime() : 0;
      if (last && now - last < DAY_MS) return; // fresh enough
      const avm = await getZillowAVM(h.address);
      if (avm == null) return; // leave prior value; retry next load
      const stamp = new Date().toISOString();
      await admin.from("holdings").update({ zillow_avm: avm, zillow_last_pulled: stamp }).eq("id", h.id);
      h.zillow_avm = avm;
      h.zillow_last_pulled = stamp;
    }),
  );

  return NextResponse.json({ holdings });
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
