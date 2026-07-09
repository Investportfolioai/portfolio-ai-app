import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fireWebhook } from "@/lib/webhooks";
import { POST as runBackgroundUnderwriting } from "@/app/api/underwriting/background/route";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

const OWNER_ID = "396a9b93-b2cd-407c-b548-99978db17c2c";

async function toBase64(file: File): Promise<string> {
  return Buffer.from(await file.arrayBuffer()).toString("base64");
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const loi = form.get("loi");
  const deck = form.get("deck");

  if (!(loi instanceof File) || loi.size === 0) {
    return NextResponse.json({ error: "An LOI PDF is required." }, { status: 400 });
  }
  if (loi.type !== "application/pdf") {
    return NextResponse.json({ error: "The LOI must be a PDF." }, { status: 400 });
  }
  if (loi.size > MAX_BYTES) {
    return NextResponse.json({ error: "The LOI exceeds the 25MB limit." }, { status: 400 });
  }

  const hasDeck = deck instanceof File && deck.size > 0;
  if (hasDeck) {
    if ((deck as File).type !== "application/pdf") {
      return NextResponse.json({ error: "The deal deck must be a PDF." }, { status: 400 });
    }
    if ((deck as File).size > MAX_BYTES) {
      return NextResponse.json({ error: "The deal deck exceeds the 25MB limit." }, { status: 400 });
    }
  }

  const loiB64 = await toBase64(loi);
  const deckB64 = hasDeck ? await toBase64(deck as File) : undefined;

  const supabase = createAdminClient();

  // Insert a minimal deal record immediately — underwriting fills in the rest asynchronously
  const { data, error } = await supabase
    .from("deals")
    .insert({
      owner_id: OWNER_ID,
      property_address: "Pending review",
      stage: "prospecting",
      structure_type: "creative",
      notes: `Submitted by ${name || "—"} · ${email || "—"} · ${phone || "—"}`,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(
      "[submit] deal insert failed:",
      JSON.stringify(
        { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint },
        null,
        2,
      ),
    );
    return NextResponse.json(
      {
        error: "Failed to save the deal. Please try again.",
        detail: error
          ? `${error.code ?? ""} ${error.message}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` (hint: ${error.hint})` : ""}`.trim()
          : "Insert returned no row.",
      },
      { status: 500 },
    );
  }

  const dealId = data.id;

  // Upload PDFs to storage so the background underwriting route can download them
  const uploads = [{ path: `${dealId}/loi.pdf`, b64: loiB64, name: "LOI.pdf" }];
  if (deckB64) uploads.push({ path: `${dealId}/deck.pdf`, b64: deckB64, name: "Deck.pdf" });
  try {
    for (const up of uploads) {
      await supabase.storage
        .from("deal-documents")
        .upload(up.path, Buffer.from(up.b64, "base64"), {
          contentType: "application/pdf",
          upsert: true,
        });
      await supabase.from("deal_documents").insert({
        deal_id: dealId,
        file_name: up.name,
        file_url: up.path,
        file_type: "application/pdf",
      });
    }
    await supabase.from("deal_activity").insert({
      deal_id: dealId,
      action: "submitted",
      note: `Submitted by ${name || "—"} (${email || "—"}).`,
    });
  } catch (e) {
    console.warn("[submit] document/activity persistence skipped:", (e as Error).message);
  }

  if (email) {
    const se = await supabase.from("deals").update({ submitter_email: email }).eq("id", dealId);
    if (se.error) console.warn("[submit] submitter_email write skipped:", se.error.message);
  }

  // Fire webhook immediately after deal exists in DB
  fireWebhook("deal.submitted", {
    id: dealId,
    property_address: "Pending review",
    status: "pending",
    purchase_price: null,
    created_at: new Date().toISOString(),
  }).catch((err) => console.error("Webhook failed silently:", err));

  // Trigger background underwriting in-process via after(): the handler runs
  // AFTER the response is sent (Vercel keeps the function alive to finish it),
  // and calling it directly avoids any self-HTTP / NEXT_PUBLIC_APP_URL dependency.
  after(async () => {
    try {
      await runBackgroundUnderwriting(
        new Request("http://internal/api/underwriting/background", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, name, email, phone, hasDeck }),
        }),
      );
    } catch (err) {
      console.error("[submit] background underwriting trigger failed:", err);
    }
  });

  return NextResponse.json({ ok: true, deal_id: dealId });
}
