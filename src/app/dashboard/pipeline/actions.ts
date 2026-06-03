"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { underwriteDeal } from "@/lib/underwriting";

export type ActionState = { ok: true } | { ok: false; error: string };

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
  if (!loiDoc) {
    return { ok: false, error: "No LOI on file to underwrite." };
  }

  async function download(path: string): Promise<string> {
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error("Could not read stored document.");
    return Buffer.from(await data.arrayBuffer()).toString("base64");
  }

  let analysis;
  try {
    const loi = { base64: await download(loiDoc.file_url) };
    const deck = deckDoc ? { base64: await download(deckDoc.file_url) } : undefined;
    analysis = await underwriteDeal(loi, deck);
  } catch (err) {
    console.error("runUnderwriting failed:", err);
    return { ok: false, error: "Underwriting failed while reading the documents." };
  }

  const u = analysis.underwriting;
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
