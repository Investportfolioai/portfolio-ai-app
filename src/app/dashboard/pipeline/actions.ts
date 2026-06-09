"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { sendWholesalerResponse, type WholesalerResponseKind } from "@/lib/email";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  underwriteDeal,
  underwriteDealData,
  extractDocumentUpdates,
  type DocExtraction,
} from "@/lib/underwriting";
import type { DealStatus, UnderwritingOutput, DealMilestone } from "@/lib/types";

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
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ status: "passed" })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  await notifyWholesaler(supabase, dealId, "rejected");
  await logActivity(dealId, "rejected", "Rejected — wholesaler notified we're passing.");
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
  const { data: stratRow } = await admin
    .from("deals")
    .select("rental_strategy")
    .eq("id", dealId)
    .maybeSingle();
  const rentalStrategy = (stratRow?.rental_strategy as string | null) ?? "ltr";

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
      analysis = await underwriteDeal(loi, deck, { rentalStrategy });
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
        rental_strategy: rentalStrategy,
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
      ai_summary: u.ai_summary,
      acquisition_grade: u.acquisition_score,
      stabilization_grade: u.stabilization_score,
    })
    .eq("id", dealId);

  await logActivity(dealId, "underwriting_run", `Tier: ${u.deal_tier ?? "—"}.`);
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

// ===========================================================================
// Session 5 (cont.) — dead status, inline edit, milestones, doc upload
// ===========================================================================

/** Mark a deal dead with a reason (starts the 120-day auto-delete countdown). */
export async function markDealDead(
  dealId: string,
  reason: string,
  intentionalPass = false,
): Promise<ActionState> {
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
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Item 4 — inline field edit on the Overview tab. */
const EDITABLE_FIELDS: Record<string, { label: string; numeric: boolean }> = {
  property_address: { label: "Address", numeric: false },
  purchase_price: { label: "Purchase Price", numeric: true },
  arv: { label: "ARV", numeric: true },
  loan_amount: { label: "Loan Amount", numeric: true },
  seller_note_amount: { label: "Seller Carry", numeric: true },
  interest_rate: { label: "Interest Rate", numeric: true },
  holdback: { label: "Holdback", numeric: true },
  lender_name: { label: "Lender", numeric: false },
  quote_number: { label: "Quote #", numeric: false },
  notes: { label: "Notes", numeric: false },
};

export async function updateDealField(
  dealId: string,
  field: string,
  value: string,
): Promise<ActionState> {
  const meta = EDITABLE_FIELDS[field];
  if (!meta) return { ok: false, error: "That field is not editable." };
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
