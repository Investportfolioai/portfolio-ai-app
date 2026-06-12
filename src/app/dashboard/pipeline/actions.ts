"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { sendWholesalerResponse, type WholesalerResponseKind } from "@/lib/email";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  underwriteDeal,
  underwriteDealData,
  extractDocumentUpdates,
  type DocExtraction,
} from "@/lib/underwriting";
import type { DealStatus, UnderwritingOutput, DealMilestone, WaterfallInput, CashflowInput } from "@/lib/types";
import { calculateMorbyWaterfall, calculateCashflow } from "@/lib/waterfall";
import { fireWebhookById } from "@/lib/webhooks";

export type ActionState = { ok: true } | { ok: false; error: string };

export interface NewDealInput {
  property_address: string;
  asset_type: string;
  purchase_price: number | null;
  arv: number | null;
  loan_amount: number | null;
  cash_invested: number | null;
  net_monthly_cashflow: number | null;
  annual_gross_revenue: number | null;
  seller_carry: number | null;
  assignment_fee: number | null;
  notes: string;
  status: DealStatus;
}

export interface ActivityEntry {
  id: string;
  action: string;
  note: string | null;
  created_at: string;
}
export interface DocumentEntry {
  id: string;
  file_name: string;
  file_type: string | null;
  url: string | null;
}
export interface DealDetail {
  activity: ActivityEntry[];
  documents: DocumentEntry[];
  milestones: DealMilestone[];
}

const BUCKET = "deal-documents";

/** Log an activity row (best-effort — never blocks the primary mutation). */
async function logActivity(dealId: string, action: string, note?: string) {
  const supabase = await createClient();
  const user = await getSessionUser();
  await supabase.from("deal_activity").insert({
    deal_id: dealId,
    action,
    note: note ?? null,
    created_by: user?.id ?? null,
  });
}

/**
 * Email the deal's submitter (the wholesaler) with our response. Best-effort —
 * a missing email / Resend key never blocks the status change.
 */
async function notifyWholesaler(
  supabase: SupabaseClient,
  dealId: string,
  kind: WholesalerResponseKind,
  message?: string,
): Promise<void> {
  try {
    const { data } = await supabase
      .from("deals")
      .select("submitter_email, property_address")
      .eq("id", dealId)
      .maybeSingle();
    if (!data?.submitter_email) return;
    await sendWholesalerResponse({
      to: data.submitter_email,
      propertyAddress: data.property_address,
      kind,
      message,
    });
  } catch (e) {
    console.warn("[wholesaler] email skipped:", (e as Error).message);
  }
}

/** Accept a deal → active, and tell the wholesaler we're moving forward. */
export async function acceptDeal(dealId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ status: "active" })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  await notifyWholesaler(supabase, dealId, "accepted");
  await logActivity(dealId, "accepted", "Accepted — wholesaler notified we're moving forward.");
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Reject a deal → passed, and tell the wholesaler we're passing for now. */
export async function rejectDeal(dealId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ status: "passed" })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  await notifyWholesaler(supabase, dealId, "rejected");
  await logActivity(dealId, "rejected", "Rejected — wholesaler notified we're passing.");
  fireWebhookById("deal.dead", dealId);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/**
 * Negotiate: email the wholesaler John's message (we're interested, want to
 * discuss terms). Status is left unchanged so the deal stays actionable.
 */
export async function negotiateDeal(
  dealId: string,
  message: string,
): Promise<ActionState> {
  const msg = message.trim();
  if (!msg) return { ok: false, error: "Enter a message to send." };

  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  await notifyWholesaler(supabase, dealId, "negotiate", msg);
  await logActivity(dealId, "negotiating", msg);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Activity log + documents (with short-lived signed URLs) for the detail panel. */
export async function getDealDetail(dealId: string): Promise<DealDetail> {
  const supabase = await createClient();

  const [activityRes, docsRes, milestonesRes] = await Promise.all([
    supabase
      .from("deal_activity")
      .select("id, action, note, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false }),
    supabase
      .from("deal_documents")
      .select("id, file_name, file_type, file_url")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("deal_milestones")
      .select("id, deal_id, label, target_date, milestone_type, source, created_at")
      .eq("deal_id", dealId)
      .order("target_date", { ascending: true }),
  ]);

  const activity = (activityRes.data ?? []) as ActivityEntry[];
  const milestones = (milestonesRes.data ?? []) as DealMilestone[];

  // Sign storage paths with the service role (private bucket).
  const admin = createAdminClient();
  const docs = (docsRes.data ?? []) as {
    id: string;
    file_name: string;
    file_type: string | null;
    file_url: string;
  }[];
  const documents: DocumentEntry[] = await Promise.all(
    docs.map(async (doc) => {
      const { data } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(doc.file_url, 60 * 60);
      return {
        id: doc.id,
        file_name: doc.file_name,
        file_type: doc.file_type,
        url: data?.signedUrl ?? null,
      };
    }),
  );

  return { activity, documents, milestones };
}

/**
 * Manually run (or re-run) underwriting on a deal using its stored PDFs.
 * Owner/partner only. Does NOT run on accept — triggered from the AI tab.
 */
export async function runUnderwriting(dealId: string): Promise<ActionState> {
  // Authorize via the SECURITY DEFINER role check (works without users_select RLS).
  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();

  // Fetch all deal fields needed for the server-side waterfall and cashflow formulas.
  const { data: dealMeta } = await admin
    .from("deals")
    .select(
      "rental_strategy, structure_type, purchase_price, seller_note_amount, ltv_percent, assignment_fee, realtor_commission, insurance_annual, taxes_annual, hoa_monthly, first_lien_monthly, seller_carry_monthly",
    )
    .eq("id", dealId)
    .maybeSingle();

  const rentalStrategy = (dealMeta?.rental_strategy as string | null) ?? "ltr";
  const structType = ((dealMeta?.structure_type as string) ?? "").toLowerCase();
  const isMorby =
    structType === "morby" || structType === "creative" || structType === "seller_finance";

  const pp = (dealMeta?.purchase_price as number | null) ?? null;
  const ltvPct = (dealMeta?.ltv_percent as number | null) ?? 75;
  const realtorCommission = (dealMeta?.realtor_commission as number | null) ?? null;
  const insuranceAnnual = (dealMeta?.insurance_annual as number | null) ?? null;
  const taxesAnnual = (dealMeta?.taxes_annual as number | null) ?? null;
  const hoaMonthly = (dealMeta?.hoa_monthly as number | null) ?? null;
  const firstLienMonthly = (dealMeta?.first_lien_monthly as number | null) ?? null;
  const sellerCarryMonthly = (dealMeta?.seller_carry_monthly as number | null) ?? null;

  // Compute full Morby waterfall server-side (authoritative — injected into AI prompt).
  let waterfall: ReturnType<typeof calculateMorbyWaterfall> | null = null;
  if (isMorby && pp != null) {
    const waterfallInput: WaterfallInput = {
      purchase_price: pp,
      ltv_percent: ltvPct,
      seller_note_amount: (dealMeta?.seller_note_amount as number | null) ?? null,
      assignment_fee: (dealMeta?.assignment_fee as number | null) ?? null,
      realtor_commission: realtorCommission,
      insurance_annual: insuranceAnnual,
      taxes_annual: taxesAnnual,
    };
    waterfall = calculateMorbyWaterfall(waterfallInput);
    console.log(
      `[underwriting] Waterfall: pp=${pp} ltv=${ltvPct}% dscr=${waterfall.dscrLoan.toFixed(0)} netToBuyer=${waterfall.netToBuyer.toFixed(0)} (${waterfall.cashbackPct.toFixed(1)}%)`,
    );
  }

  // Context injected into the AI prompt — AI should NOT recalculate any of these numbers.
  const cashbackNote = waterfall != null
    ? `\n\nSERVER-COMPUTED FACTS (authoritative — use these exact figures in your output):\n` +
      `- DSCR Loan (${ltvPct}% LTV): $${waterfall.dscrLoan.toFixed(0)}\n` +
      `- Funding Gap (pass-through): $${waterfall.fundingGap.toFixed(0)}\n` +
      `- TL Fee (3.5% of gap): $${waterfall.tlFee.toFixed(0)}\n` +
      `- Closing Costs (2.5%): $${waterfall.closingCosts.toFixed(0)}\n` +
      `- Prepaid Insurance: $${waterfall.prepaidInsurance.toFixed(0)}\n` +
      `- Prepaid Taxes: $${waterfall.prepaidTaxes.toFixed(0)}\n` +
      (waterfall.realtorCommission > 0 ? `- Realtor Commission: $${waterfall.realtorCommission.toFixed(0)}\n` : "") +
      `- DPTS — Cash to Seller: $${waterfall.dpts.toFixed(0)}\n` +
      `- Assignment Fee: $${waterfall.assignmentFee.toFixed(0)}\n` +
      `- Credit Partner Fee (5%): $${waterfall.creditPartnerFee.toFixed(0)}\n` +
      `- NET TO BUYER: $${waterfall.netToBuyer.toFixed(0)}\n` +
      `- Cashback %: ${waterfall.cashbackPct.toFixed(2)}%\n` +
      `- Portfolio AI Fee (10%): $${waterfall.portfolioAIFee.toFixed(0)}\n\n` +
      `Set cashback_amount = ${waterfall.netToBuyer.toFixed(0)} and cashback_pct = ${waterfall.cashbackPct.toFixed(2)} in submit_underwriting. Do NOT recalculate.`
    : undefined;

  const { data: docs } = await admin
    .from("deal_documents")
    .select("file_name, file_url")
    .eq("deal_id", dealId);

  const loiDoc = docs?.find((d) => /loi/i.test(d.file_name));
  const deckDoc = docs?.find((d) => /deck/i.test(d.file_name));

  async function download(path: string): Promise<string> {
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error("Could not read stored document.");
    return Buffer.from(await data.arrayBuffer()).toString("base64");
  }

  let analysis: UnderwritingOutput;
  try {
    if (loiDoc) {
      // Document path — underwrite from the uploaded PDFs.
      const loi = { base64: await download(loiDoc.file_url) };
      const deck = deckDoc ? { base64: await download(deckDoc.file_url) } : undefined;
      analysis = await underwriteDeal(loi, deck, { rentalStrategy, cashbackNote });
    } else {
      // No PDFs on file — underwrite from the deal's structured data.
      const { data: deal } = await admin
        .from("deals")
        .select(
          "property_address, city, state, structure_type, purchase_price, arv, loan_amount, initial_advance, holdback, interest_rate, ltv, ltv_percent, seller_note_amount, seller_note_rate, assignment_fee, exit_strategy, lender_name, quote_number, notes, ai_analysis",
        )
        .eq("id", dealId)
        .maybeSingle();
      if (!deal) return { ok: false, error: "Deal not found." };
      const manual =
        (deal.ai_analysis as UnderwritingOutput | null)?.extracted_deal_data ?? null;
      const { ai_analysis: _drop, ...cols } = deal;
      analysis = await underwriteDealData(
        {
          ...cols,
          rental_strategy: rentalStrategy,
          property_type: manual?.property_type ?? null,
          total_cash_invested: manual?.total_cash_invested ?? null,
          net_monthly_cashflow: manual?.net_monthly_cashflow ?? null,
        },
        { cashbackNote },
      );
    }
  } catch (err) {
    console.error("runUnderwriting failed:", err);
    return { ok: false, error: "Underwriting failed. Please try again." };
  }

  const u = analysis.underwriting;
  if (!u) return { ok: false, error: "Underwriting returned no analysis." };

  // Override cashback with server-computed waterfall values (authoritative).
  if (isMorby && waterfall != null) {
    u.cashback_amount = waterfall.netToBuyer;
    u.cashback_pct = waterfall.cashbackPct;
    u.first_lien_amount = waterfall.dscrLoan;
  }
  const cashbackAtClose = isMorby && waterfall != null
    ? waterfall.netToBuyer
    : (u.cashback_amount ?? null);

  // Compute cashflow post-AI using the AI's rent estimate + deal cost inputs.
  let cashflowResult: ReturnType<typeof calculateCashflow> | null = null;
  if (u.current_rent && pp != null) {
    const cashflowInput: CashflowInput = {
      purchase_price: pp,
      insurance_annual: insuranceAnnual,
      taxes_annual: taxesAnnual,
      hoa_monthly: hoaMonthly,
      first_lien_monthly: firstLienMonthly,
      seller_carry_monthly: sellerCarryMonthly,
    };
    cashflowResult = calculateCashflow(cashflowInput, u.current_rent);
  }

  // Attach server-computed waterfall and cashflow to the JSONB for display.
  analysis.waterfall = waterfall ?? undefined;
  analysis.cashflow = cashflowResult ?? undefined;

  await admin
    .from("deals")
    .update({
      ai_analysis: analysis,
      ai_summary: u.ai_summary,
      acquisition_grade: u.acquisition_score,
      stabilization_grade: u.stabilization_score,
      cashback_at_close: cashbackAtClose,
      tl_fee: waterfall?.tlFee ?? null,
      tl_repayment: waterfall != null ? waterfall.fundingGap + waterfall.tlFee : null,
      credit_partner_fee: waterfall?.creditPartnerFee ?? null,
      portfolio_ai_fee: waterfall?.portfolioAIFee ?? null,
    })
    .eq("id", dealId);

  await logActivity(dealId, "underwriting_run", `Tier: ${u.deal_tier ?? "—"}.`);
  fireWebhookById("deal.underwritten", dealId);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/**
 * Set a deal's rental strategy (ltr/str) and re-underwrite with the matching
 * rental-comp search. Owner/partner only.
 */
export async function setRentalStrategy(
  dealId: string,
  strategy: "ltr" | "str",
): Promise<ActionState> {
  if (strategy !== "ltr" && strategy !== "str") {
    return { ok: false, error: "Invalid strategy." };
  }
  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("deals")
    .update({ rental_strategy: strategy })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  // Re-underwrite with the new strategy (runUnderwriting reads rental_strategy).
  return runUnderwriting(dealId);
}

/**
 * Manually add a deal. Asset type + CRM inputs are stored in ai_analysis (no
 * dedicated columns); grades stay null (pending) until underwriting is run.
 */
export async function createDeal(
  input: NewDealInput,
): Promise<ActionState & { dealId?: string }> {
  const address = input.property_address.trim();
  if (!address) return { ok: false, error: "Property address is required." };

  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const aiAnalysis = {
    extracted_deal_data: {
      property_address: address,
      property_type: input.asset_type || null,
      purchase_price: input.purchase_price,
      arv: input.arv,
      loan_amount: input.loan_amount,
      seller_note_amount: input.seller_carry,
      assignment_fee: input.assignment_fee,
      total_cash_invested: input.cash_invested,
      net_monthly_cashflow: input.net_monthly_cashflow,
      annual_gross_revenue: input.annual_gross_revenue,
    },
    underwriting: null,
  };

  const { data, error } = await supabase
    .from("deals")
    .insert({
      property_address: address,
      structure_type: "creative",
      stage: "prospecting",
      status: input.status,
      purchase_price: input.purchase_price,
      arv: input.arv,
      loan_amount: input.loan_amount,
      seller_note_amount: input.seller_carry,
      assignment_fee: input.assignment_fee,
      notes: input.notes.trim() || null,
      ai_analysis: aiAnalysis,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the deal." };
  }
  await logActivity(data.id, "created", "Deal added manually.");
  revalidatePath("/dashboard/pipeline");
  return { ok: true, dealId: data.id };
}

// ===========================================================================
// Session 5 (cont.) — dead status, inline edit, milestones, doc upload
// ===========================================================================

/** Mark a deal dead with a reason (starts the 120-day auto-delete countdown). */
export async function markDealDead(
  dealId: string,
  reason: string,
  intentionalPass = false,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({
      status: "dead",
      status_changed_at: new Date().toISOString(),
      intentional_pass: intentionalPass,
    })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  await logActivity(
    dealId,
    "marked_dead",
    `${reason || "No reason"}${intentionalPass ? " (intentional pass — outside buybox)" : ""} — auto-deletes in 120 days.`,
  );
  fireWebhookById("deal.dead", dealId);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Mark a deal closed — sets status = 'closed', records closed_at, and auto-creates a holding. */
export async function markDealClosed(
  dealId: string,
): Promise<{ ok: true; holdingCreated: boolean } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  // Use the admin client for the status update so RLS never blocks it and we
  // get a clear error if the enum value is missing rather than a silent fail.
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { error: updateError } = await admin
    .from("deals")
    .update({ status: "closed", closed_at: now, status_changed_at: now })
    .eq("id", dealId);
  if (updateError) {
    console.error("[markDealClosed] deal update failed:", updateError.message);
    return { ok: false, error: updateError.message };
  }

  await logActivity(dealId, "closed", "Deal marked as closed.");
  fireWebhookById("deal.closed", dealId);

  // Auto-create a holding from the deal data.
  let holdingCreated = false;
  try {
    const { data: deal } = await admin
      .from("deals")
      .select(
        "owner_id, property_address, purchase_price, arv, structure_type, first_lien_monthly, seller_carry_monthly, seller_note_amount, ai_analysis",
      )
      .eq("id", dealId)
      .maybeSingle();

    if (deal) {
      // Dedup: two separate queries to avoid interpolating the address into the
      // filter string (spaces in addresses break the .or() syntax).
      const { data: byLink } = await admin
        .from("holdings")
        .select("id")
        .eq("linked_deal_id", dealId)
        .maybeSingle();

      const { data: byAddr } = !byLink
        ? await admin
            .from("holdings")
            .select("id")
            .eq("address", deal.property_address)
            .maybeSingle()
        : { data: null };

      if (!byLink && !byAddr) {
        // Compute balloon_date from balloon_term_months in AI analysis if present.
        const ai = deal.ai_analysis as { extracted_deal_data?: { balloon_term_months?: number } } | null;
        const balloonMonths = ai?.extracted_deal_data?.balloon_term_months ?? null;
        let balloonDate: string | null = null;
        if (typeof balloonMonths === "number" && balloonMonths > 0) {
          const d = new Date(now);
          d.setMonth(d.getMonth() + balloonMonths);
          balloonDate = d.toISOString().slice(0, 10);
        }

        const { error: insertError } = await admin.from("holdings").insert({
          owner_id: deal.owner_id ?? user.id,
          address: deal.property_address,
          purchase_close_price: deal.purchase_price ?? null,
          purchase_price: deal.purchase_price ?? null,
          acquisition_date: now.slice(0, 10),
          zillow_avm: deal.arv ?? null,
          property_type: deal.structure_type ?? null,
          status: "active",
          linked_deal_id: dealId,
          monthly_payment: deal.first_lien_monthly ?? null,
          seller_carry_payment: deal.seller_carry_monthly ?? null,
          seller_carry_balance: deal.seller_note_amount ?? null,
          balloon_date: balloonDate,
        });

        if (insertError) {
          console.warn("[markDealClosed] holding insert failed:", insertError.message);
        } else {
          holdingCreated = true;
        }
      }
    }
  } catch (e) {
    console.warn("[markDealClosed] holding auto-create skipped:", (e as Error).message);
  }

  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/portfolio");
  return { ok: true, holdingCreated };
}

/** Item 4 — inline field edit on the Overview tab. */
const EDITABLE_FIELDS: Record<string, { label: string; numeric: boolean }> = {
  property_address: { label: "Address", numeric: false },
  purchase_price: { label: "Purchase Price", numeric: true },
  arv: { label: "ARV", numeric: true },
  loan_amount: { label: "Loan Amount", numeric: true },
  ltv_percent: { label: "LTV %", numeric: true },
  seller_note_amount: { label: "Seller Note Balance", numeric: true },
  assignment_fee: { label: "Assignment Fee", numeric: true },
  interest_rate: { label: "Interest Rate", numeric: true },
  holdback: { label: "Holdback", numeric: true },
  lender_name: { label: "Lender", numeric: false },
  quote_number: { label: "Quote #", numeric: false },
  notes: { label: "Notes", numeric: false },
  // Cost inputs for waterfall / cashflow underwriting
  realtor_commission: { label: "Realtor Commission", numeric: true },
  insurance_annual: { label: "Insurance (Annual)", numeric: true },
  taxes_annual: { label: "Taxes (Annual)", numeric: true },
  hoa_monthly: { label: "HOA (Monthly)", numeric: true },
  first_lien_monthly: { label: "First Lien / mo", numeric: true },
  seller_carry_monthly: { label: "Seller Carry / mo", numeric: true },
};

export async function updateDealField(
  dealId: string,
  field: string,
  value: string,
): Promise<ActionState> {
  const meta = EDITABLE_FIELDS[field];
  if (!meta) return { ok: false, error: "That field is not editable." };
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  let parsed: string | number | null;
  if (meta.numeric) {
    const v = value.trim();
    parsed = v === "" ? null : Number(v);
    if (parsed !== null && Number.isNaN(parsed)) {
      return { ok: false, error: "Enter a valid number." };
    }
  } else {
    parsed = value.trim() || null;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("deals").update({ [field]: parsed }).eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  await logActivity(dealId, "field_edited", `${meta.label} → ${value.trim() || "—"}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Item 2 — milestones. */
export async function createMilestone(
  dealId: string,
  m: { label: string; target_date: string; milestone_type: string },
  source: "manual" | "ai_extracted" = "manual",
): Promise<ActionState> {
  if (!m.label?.trim() || !m.target_date) {
    return { ok: false, error: "Label and date are required." };
  }
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase.from("deal_milestones").insert({
    deal_id: dealId,
    label: m.label.trim(),
    target_date: m.target_date,
    milestone_type: m.milestone_type || "custom",
    source,
  });
  if (error) return { ok: false, error: error.message };
  await logActivity(dealId, "milestone_added", `${m.label.trim()} — ${m.target_date}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

export async function deleteMilestone(
  milestoneId: string,
  dealId: string,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase.from("deal_milestones").delete().eq("id", milestoneId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

export async function getDealMilestonesAction(dealId: string): Promise<DealMilestone[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_milestones")
    .select("id, deal_id, label, target_date, milestone_type, source, created_at")
    .eq("deal_id", dealId)
    .order("target_date", { ascending: true });
  return (data ?? []) as DealMilestone[];
}

/** Item 3 — upload a document, store it, extract dates + term changes. */
export type UploadResult =
  | { ok: true; extraction: DocExtraction }
  | { ok: false; error: string };

export async function uploadDealDocument(
  dealId: string,
  formData: FormData,
): Promise<UploadResult> {
  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file selected." };
  if (file.type !== "application/pdf") return { ok: false, error: "PDF files only." };

  const admin = createAdminClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${dealId}/${Date.now()}-${safe}`;

  const up = await admin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: "application/pdf", upsert: false });
  if (up.error) return { ok: false, error: up.error.message };

  await admin.from("deal_documents").insert({
    deal_id: dealId,
    file_name: file.name,
    file_url: path,
    file_type: "application/pdf",
  });
  await logActivity(dealId, "document_uploaded", file.name);

  let extraction: DocExtraction;
  try {
    extraction = await extractDocumentUpdates(buf.toString("base64"));
  } catch (e) {
    console.error("extractDocumentUpdates failed:", e);
    revalidatePath("/dashboard/pipeline");
    return { ok: false, error: "Uploaded, but date/term extraction failed." };
  }

  // Auto-populate the Timeline with extracted dates (term changes are confirmed in the UI).
  for (const ms of extraction.milestones) {
    await admin.from("deal_milestones").insert({
      deal_id: dealId,
      label: ms.label,
      target_date: ms.target_date,
      milestone_type: ms.milestone_type,
      source: "ai_extracted",
    });
  }
  if (extraction.milestones.length > 0) {
    await logActivity(
      dealId,
      "dates_extracted",
      `Added ${extraction.milestones.length} milestone date(s) from ${file.name}.`,
    );
  }

  revalidatePath("/dashboard/pipeline");
  return { ok: true, extraction };
}

/** Item 5 — edit CRM/revenue fields stored in ai_analysis.extracted_deal_data. */
const EDITABLE_AI_FIELDS: Record<string, string> = {
  total_cash_invested: "Cash Invested",
  net_monthly_cashflow: "Net Monthly Cash Flow",
  annual_gross_revenue: "Annual Gross Revenue",
};

export async function updateDealAiField(
  dealId: string,
  key: string,
  value: string,
): Promise<ActionState> {
  const label = EDITABLE_AI_FIELDS[key];
  if (!label) return { ok: false, error: "That field is not editable." };
  const v = value.trim();
  const parsed = v === "" ? null : Number(v);
  if (parsed !== null && Number.isNaN(parsed)) {
    return { ok: false, error: "Enter a valid number." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("deals")
    .select("ai_analysis")
    .eq("id", dealId)
    .maybeSingle();
  const existing = (data?.ai_analysis as UnderwritingOutput | null) ?? {
    extracted_deal_data: {},
    underwriting: null,
  };
  const next = {
    ...existing,
    extracted_deal_data: { ...(existing.extracted_deal_data ?? {}), [key]: parsed },
  };
  const { error } = await supabase
    .from("deals")
    .update({ ai_analysis: next })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  await logActivity(dealId, "field_edited", `${label} → ${v || "—"}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
