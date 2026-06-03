import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Insert an SREO row owned by the signed-in KP (RLS: kp_id = auth.uid()). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const property_name = String(body.property_name ?? "").trim();
  if (!property_name) {
    return NextResponse.json({ ok: false, error: "Property name is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("kp_sreo").insert({
    kp_id: user.id,
    property_name,
    property_type: String(body.property_type ?? "").trim() || null,
    address: String(body.address ?? "").trim() || null,
    value: num(body.value),
    mortgage_balance: num(body.mortgage_balance),
    monthly_payment: num(body.monthly_payment),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Remove an SREO row (RLS restricts deletion to the owning KP). */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("kp_sreo").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
