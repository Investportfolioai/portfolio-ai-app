"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { sendKpDealBrief } from "@/lib/email";
import type {
  AssignmentStatus,
  AvailableKp,
  KpAssignment,
} from "@/lib/types";

export type KpActionState = { ok: true } | { ok: false; error: string };

/**
 * Assign a KP to a deal (status defaults to "pending") and email them a deal
 * brief with Accept / Decline links. Owner/partner only (enforced by RLS on
 * deal_kps; the email is best-effort).
 */
export async function assignKpToDeal(
  dealId: string,
  kpId: string,
): Promise<KpActionState> {
  if (!dealId || !kpId) return { ok: false, error: "Missing deal or KP." };
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("deal_kps")
    .insert({ deal_id: dealId, kp_id: kpId, status: "pending" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // Pull the brief inputs + KP email, then send. Best-effort — a missing email
  // or Resend key must not fail the assignment.
  const [{ data: deal }, { data: kp }] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "property_address, structure_type, purchase_price, arv, acquisition_grade, stabilization_grade, ai_summary, ai_analysis",
      )
      .eq("id", dealId)
      .maybeSingle(),
    supabase.from("users").select("email, full_name").eq("id", kpId).maybeSingle(),
  ]);

  if (deal && kp?.email && row?.id) {
    const summary =
      deal.ai_summary ??
      deal.ai_analysis?.underwriting?.summary ??
      "";
    try {
      await sendKpDealBrief({
        kpEmail: kp.email,
        kpName: kp.full_name ?? null,
        assignmentId: row.id,
        propertyAddress: deal.property_address,
        structureType: deal.structure_type,
        purchasePrice: deal.purchase_price,
        arv: deal.arv,
        acquisitionGrade: deal.acquisition_grade,
        stabilizationGrade: deal.stabilization_grade,
        aiSummary: summary,
      });
    } catch (e) {
      console.error("sendKpDealBrief failed:", e);
    }
  }

  await logKpActivity(dealId, "kp_assigned", kp?.full_name ?? null);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/** Current KP assignments for a deal, newest first. */
export async function getDealKpAssignments(
  dealId: string,
): Promise<KpAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_kps")
    .select("id, kp_id, status, responded_at, kp:kp_id(full_name, email)")
    .eq("deal_id", dealId)
    .order("assigned_at", { ascending: false });
  if (error) return [];

  return ((data ?? []) as unknown as {
    id: string;
    kp_id: string;
    status: AssignmentStatus | null;
    responded_at: string | null;
    kp: { full_name: string | null; email: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    kp_id: r.kp_id,
    kp_name: r.kp?.full_name ?? null,
    kp_email: r.kp?.email ?? null,
    status: r.status ?? "pending",
    responded_at: r.responded_at,
  }));
}

/** KPs (role = kp) not already assigned to this deal. */
export async function getAvailableKps(dealId: string): Promise<AvailableKp[]> {
  const supabase = await createClient();
  const [{ data: kps }, { data: assigned }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("role", "kp")
      .order("full_name"),
    supabase.from("deal_kps").select("kp_id").eq("deal_id", dealId),
  ]);
  const taken = new Set((assigned ?? []).map((a) => a.kp_id as string));
  return ((kps ?? []) as AvailableKp[]).filter((k) => !taken.has(k.id));
}

/** Remove a KP assignment. Owner/partner only (RLS). */
export async function removeKpAssignment(
  assignmentId: string,
  dealId: string,
): Promise<KpActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("deal_kps")
    .delete()
    .eq("id", assignmentId);
  if (error) return { ok: false, error: error.message };
  await logKpActivity(dealId, "kp_unassigned");
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/**
 * Record a KP's accept/decline. Called from the public /kp/respond link (the
 * KP is not logged in) and from the KP dashboard, so it authorizes via the
 * unguessable assignment id and writes with the service role.
 */
export async function respondToAssignment(
  assignmentId: string,
  action: AssignmentStatus,
): Promise<KpActionState> {
  if (action !== "accepted" && action !== "declined") {
    return { ok: false, error: "Invalid response." };
  }
  if (!assignmentId) return { ok: false, error: "Missing assignment." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deal_kps")
    .update({ status: action, responded_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .select("deal_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Assignment not found." };

  await admin.from("deal_activity").insert({
    deal_id: data.deal_id,
    action: action === "accepted" ? "kp_accepted" : "kp_declined",
    note: null,
  });
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/kp/dashboard");
  return { ok: true };
}

/** Best-effort activity log for the assigning owner/partner's session. */
async function logKpActivity(dealId: string, action: string, note?: string | null) {
  const supabase = await createClient();
  const user = await getSessionUser();
  await supabase.from("deal_activity").insert({
    deal_id: dealId,
    action,
    note: note ?? null,
    created_by: user?.id ?? null,
  });
}
