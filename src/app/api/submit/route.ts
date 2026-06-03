import { NextResponse } from "next/server";
import { underwriteDeal, type UnderwritingOutput } from "@/lib/underwriting";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSubmissionNotification } from "@/lib/email";

// Node runtime: needs Buffer + the Anthropic SDK. Allow a long AI call.
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25MB per file

async function toBase64(file: File): Promise<string> {
  return Buffer.from(await file.arrayBuffer()).toString("base64");
}

function buildNotes(
  contact: { name: string; email: string; phone: string },
  out: UnderwritingOutput,
): string {
  const d = out.extracted_deal_data;
  const u = out.underwriting;
  const lines = [
    `Submitted by ${contact.name || "—"} · ${contact.email || "—"} · ${contact.phone || "—"}`,
    d.property_type ? `Property type: ${d.property_type}` : null,
    d.balloon_term_months != null ? `Balloon: ${d.balloon_term_months} months` : null,
    u?.risks.length ? `Risks: ${u.risks.join("; ")}` : null,
    u?.conditions.length ? `Conditions: ${u.conditions.join("; ")}` : null,
  ].filter(Boolean);
  return lines.join("\n");
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

  // Validate the required LOI.
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

  // Read the PDFs once (used for both underwriting and storage).
  const loiB64 = await toBase64(loi);
  const deckB64 = hasDeck ? await toBase64(deck as File) : undefined;

  // Run the AI underwriting engine on the PDFs.
  let result: UnderwritingOutput;
  try {
    result = await underwriteDeal({ base64: loiB64 }, deckB64 ? { base64: deckB64 } : undefined);
  } catch (err) {
    console.error("underwriteDeal failed:", err);
    return NextResponse.json(
      { error: "Underwriting failed while reading the documents. Please try again." },
      { status: 502 },
    );
  }

  // Auto-populate the deal record (service role bypasses RLS for this trusted insert).
  const d = result.extracted_deal_data;
  const u = result.underwriting;
  if (!u) {
    return NextResponse.json(
      { error: "Underwriting returned no analysis. Please try again." },
      { status: 502 },
    );
  }
  const supabase = createAdminClient();

  const insertRow = {
    property_address: d.property_address ?? "Untitled submission",
    city: d.city,
    state: d.state,
    structure_type: d.structure_type ?? "creative",
    stage: "prospecting",
    purchase_price: d.purchase_price,
    arv: d.arv,
    loan_amount: d.loan_amount,
    initial_advance: d.initial_advance,
    holdback: d.holdback,
    interest_rate: d.interest_rate,
    seller_note_amount: d.seller_note_amount,
    seller_note_rate: d.seller_note_rate,
    assignment_fee: d.assignment_fee,
    origination_fee: d.origination_fee,
    exit_strategy: d.exit_strategy,
    lender_name: d.lender_name,
    quote_number: d.quote_number,
    ai_summary: u.summary,
    notes: buildNotes({ name, email, phone }, result),
  };

  const { data, error } = await supabase
    .from("deals")
    .insert(insertRow)
    .select("id")
    .single();

  if (error || !data) {
    console.error("deal insert failed:", error?.message);
    return NextResponse.json(
      { error: "Underwriting succeeded but saving the deal failed." },
      { status: 500 },
    );
  }

  // Best-effort enrichment — columns/tables/bucket may not exist until the
  // pending migrations are applied; failures here never undo the deal.
  const dealId = data.id;

  const enrich = await supabase
    .from("deals")
    .update({
      ai_analysis: result,
      acquisition_grade: u.acquisition_grade,
      stabilization_grade: u.stabilization_grade,
    })
    .eq("id", dealId);
  if (enrich.error) console.warn("analysis/grade write skipped:", enrich.error.message);

  // Persist the source PDFs to storage + register them as documents.
  try {
    const uploads = [{ path: `${dealId}/loi.pdf`, b64: loiB64, name: "LOI.pdf" }];
    if (deckB64) uploads.push({ path: `${dealId}/deck.pdf`, b64: deckB64, name: "Deck.pdf" });
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
    console.warn("document/activity persistence skipped:", (e as Error).message);
  }

  // Notify the owner (best-effort — never blocks the submission).
  try {
    await sendSubmissionNotification({
      submitterName: name,
      submitterEmail: email,
      submitterPhone: phone,
      propertyAddress: insertRow.property_address,
      acquisitionGrade: u.acquisition_grade,
      stabilizationGrade: u.stabilization_grade,
      recommendation: u.recommendation,
      summary: u.summary,
    });
  } catch (e) {
    console.warn("submission email skipped:", (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    deal_id: data.id,
    address: insertRow.property_address,
    recommendation: u.recommendation,
    acquisition_grade: u.acquisition_grade,
    stabilization_grade: u.stabilization_grade,
    summary: u.summary,
  });
}
