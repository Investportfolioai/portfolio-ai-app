"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { underwriteDeal, underwriteDealData } from "@/lib/underwriting";
import type { DealStatus, UnderwritingOutput } from "@/lib/types";

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

/** Accept a pending deal → active. Underwriting is queued, NOT auto-triggered. */
export async function acceptDeal(dealId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ status: "active" })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  await logActivity(dealId, "accepted", "Accepted — underwriting queued.");
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Pass on a pending deal → passed, with an optional reason. */
export async function passDeal(
  dealId: string,
  reason: string,
): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ status: "passed" })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  await logActivity(dealId, "passed", reason.trim() || "No reason given.");
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Activity log + documents (with short-lived signed URLs) for the detail panel. */
export async function getDealDetail(dealId: string): Promise<DealDetail> {
  const supabase = await createClient();

  const [activityRes, docsRes] = await Promise.all([
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
  ]);

  const activity = (activityRes.data ?? []) as ActivityEntry[];

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

  return { activity, documents };
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
      analysis = await underwriteDeal(loi, deck);
    } else {
      // No PDFs on file — underwrite from the deal's structured data.
      const { data: deal } = await admin
        .from("deals")
        .select(
          "property_address, city, state, structure_type, purchase_price, arv, loan_amount, initial_advance, holdback, interest_rate, ltv, seller_note_amount, seller_note_rate, exit_strategy, lender_name, quote_number, notes, ai_analysis",
        )
        .eq("id", dealId)
        .maybeSingle();
      if (!deal) return { ok: false, error: "Deal not found." };
      const manual =
        (deal.ai_analysis as UnderwritingOutput | null)?.extracted_deal_data ?? null;
      const { ai_analysis: _drop, ...cols } = deal;
      analysis = await underwriteDealData({
        ...cols,
        property_type: manual?.property_type ?? null,
        total_cash_invested: manual?.total_cash_invested ?? null,
        net_monthly_cashflow: manual?.net_monthly_cashflow ?? null,
      });
    }
  } catch (err) {
    console.error("runUnderwriting failed:", err);
    return { ok: false, error: "Underwriting failed. Please try again." };
  }

  const u = analysis.underwriting;
  if (!u) return { ok: false, error: "Underwriting returned no analysis." };
  await admin
    .from("deals")
    .update({
      ai_analysis: analysis,
      ai_summary: u.summary,
      acquisition_grade: u.acquisition_grade,
      stabilization_grade: u.stabilization_grade,
    })
    .eq("id", dealId);

  await logActivity(dealId, "underwriting_run", `Recommendation: ${u.recommendation}.`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
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

  const supabase = await createClient();
  const aiAnalysis = {
    extracted_deal_data: {
      property_address: address,
      property_type: input.asset_type || null,
      purchase_price: input.purchase_price,
      arv: input.arv,
      loan_amount: input.loan_amount,
      seller_note_amount: input.seller_carry,
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
