import { NextResponse } from "next/server";
import { underwriteDeal, type UnderwritingOutput } from "@/lib/underwriting";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSubmissionNotification } from "@/lib/email";
import { calculateMorbyWaterfall } from "@/lib/waterfall";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    u?.deal_tier ? `Tier: ${u.deal_tier}` : null,
    u?.important_flags?.length ? `Flags: ${u.important_flags.join("; ")}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export async function POST(req: Request) {
  let body: { dealId: string; name: string; email: string; phone: string; hasDeck: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { dealId, name, email, phone, hasDeck } = body;
  if (!dealId) {
    return NextResponse.json({ error: "dealId is required." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Download PDFs from storage — uploaded by the submit route before it returned
  let loiB64: string;
  try {
    const { data: loiData, error: loiError } = await admin.storage
      .from("deal-documents")
      .download(`${dealId}/loi.pdf`);
    if (loiError || !loiData) throw loiError ?? new Error("LOI download returned no data");
    loiB64 = Buffer.from(await loiData.arrayBuffer()).toString("base64");
  } catch (err) {
    console.error("[bg-underwriting] LOI download failed:", err);
    return NextResponse.json({ error: "Failed to download LOI from storage." }, { status: 500 });
  }

  let deckB64: string | undefined;
  if (hasDeck) {
    try {
      const { data: deckData, error: deckError } = await admin.storage
        .from("deal-documents")
        .download(`${dealId}/deck.pdf`);
      if (deckError || !deckData) throw deckError ?? new Error("Deck download returned no data");
      deckB64 = Buffer.from(await deckData.arrayBuffer()).toString("base64");
    } catch (err) {
      console.warn("[bg-underwriting] deck download failed — proceeding without deck:", err);
    }
  }

  // Run AI underwriting
  console.log(`[bg-underwriting] starting for deal ${dealId}`);
  let result: UnderwritingOutput;
  try {
    result = await underwriteDeal({ base64: loiB64 }, deckB64 ? { base64: deckB64 } : undefined);
  } catch (err) {
    console.error("[bg-underwriting] underwriteDeal failed:", err);
    return NextResponse.json({ error: "Underwriting failed." }, { status: 502 });
  }

  const d = result.extracted_deal_data;
  const u = result.underwriting;
  const contact = { name: name || "", email: email || "", phone: phone || "" };

  // Update deal record with extracted data and underwriting results
  const { error: updateError } = await admin
    .from("deals")
    .update({
      property_address: d.property_address ?? "Untitled submission",
      city: d.city,
      state: d.state,
      structure_type: d.structure_type ?? "creative",
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
      ai_summary: u?.ai_summary,
      notes: buildNotes(contact, result),
      ai_analysis: result,
      acquisition_grade: u?.acquisition_score,
      stabilization_grade: u?.stabilization_score,
    })
    .eq("id", dealId);

  if (updateError) {
    console.error("[bg-underwriting] deal update failed:", updateError.message);
  } else {
    console.log(`[bg-underwriting] deal ${dealId} updated with underwriting results`);
  }

  // Waterfall: populate cashback_at_close, credit_partner_fee, portfolio_ai_fee in the same
  // pass as grades. Only runs for Morby/creative/seller_finance structures. Guards:
  // - seller_note_amount must be non-null (null → DPTS = full purchase_price → garbage negative netToBuyer)
  // - purchase_price must be non-null (waterfall requires it)
  // - deal must not be closed (closed cashback was set at actual close)
  // - result must be sane (no NaN, netToBuyer >= 0)
  if (!updateError) {
    const structType = ((d.structure_type ?? "creative") as string).toLowerCase();
    const isMorbyDeal =
      structType === "morby" || structType === "creative" || structType === "seller_finance";

    if (isMorbyDeal) {
      const { data: dealRow } = await admin
        .from("deals")
        .select(
          "purchase_price, ltv_percent, seller_note_amount, assignment_fee, realtor_commission, insurance_annual, taxes_annual, tc_fee, attorney_fee, pm_fee, dpts_override, status",
        )
        .eq("id", dealId)
        .maybeSingle();

      if (!dealRow || dealRow.purchase_price == null) {
        console.log(`[bg-underwriting] waterfall skipped for ${dealId}: purchase_price missing`);
      } else if (dealRow.seller_note_amount == null) {
        console.log(`[bg-underwriting] waterfall skipped for ${dealId}: seller_note_amount missing`);
      } else if (dealRow.status === "closed") {
        console.log(`[bg-underwriting] waterfall skipped for ${dealId}: deal is closed`);
      } else {
        const w = calculateMorbyWaterfall({
          purchase_price: dealRow.purchase_price,
          ltv_percent: dealRow.ltv_percent ?? null,
          seller_note_amount: dealRow.seller_note_amount,
          assignment_fee: dealRow.assignment_fee ?? null,
          realtor_commission: dealRow.realtor_commission ?? null,
          insurance_annual: dealRow.insurance_annual ?? null,
          taxes_annual: dealRow.taxes_annual ?? null,
          tc_fee: dealRow.tc_fee ?? null,
          attorney_fee: dealRow.attorney_fee ?? null,
          pm_fee: dealRow.pm_fee ?? null,
          dpts_override: dealRow.dpts_override ?? null,
        });
        const hasNaN = (Object.values(w) as unknown[]).some(
          (v) => typeof v === "number" && isNaN(v),
        );
        if (hasNaN || w.netToBuyer < 0) {
          console.warn(
            `[bg-underwriting] waterfall skipped for ${dealId}: invalid result (netToBuyer=${w.netToBuyer.toFixed(0)}, hasNaN=${hasNaN})`,
          );
        } else {
          const { error: wErr } = await admin
            .from("deals")
            .update({
              cashback_at_close: w.netToBuyer,
              credit_partner_fee: w.creditPartnerFee,
              portfolio_ai_fee: w.portfolioAIFee,
            })
            .eq("id", dealId);
          if (wErr) {
            console.error(`[bg-underwriting] waterfall write failed for ${dealId}:`, wErr.message);
          } else {
            console.log(
              `[bg-underwriting] waterfall written for ${dealId}: netToBuyer=${w.netToBuyer.toFixed(0)} (${w.cashbackPct.toFixed(1)}%)`,
            );
          }
        }
      }
    }
  }

  // Send submission notification email once underwriting grades are available
  if (u) {
    try {
      await sendSubmissionNotification({
        submitterName: contact.name,
        submitterEmail: contact.email,
        submitterPhone: contact.phone,
        propertyAddress: d.property_address ?? "Untitled submission",
        acquisitionGrade: u.acquisition_score,
        stabilizationGrade: u.stabilization_score,
        recommendation: u.recommendation ?? "proceed_with_conditions",
        summary: u.ai_summary,
      });
    } catch (e) {
      console.warn("[bg-underwriting] email notification skipped:", (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, deal_id: dealId });
}
