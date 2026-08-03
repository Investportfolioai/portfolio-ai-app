"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { updateDealField } from "./actions";
import { EDITABLE_FIELDS } from "@/lib/editable-fields";
import type { DealUpdateSource, DealUpdateEventType, ProposedChanges } from "@/lib/types";

export type DealUpdateActionState = { ok: true } | { ok: false; error: string };

export interface ApproveConflict {
  field: string;
  label: string;
  proposedNew: string | number | null;
  expectedWas: string | number | null;
  currentValue: string | number | null;
}
export type ApproveResult =
  | { ok: true; applied: string[] }
  | { ok: false; error: string; conflicts?: ApproveConflict[] };

export interface PendingDealUpdate {
  id: string;
  deal_id: string;
  deal_address: string;
  source: DealUpdateSource;
  source_ref: string | null;
  author_name: string | null;
  event_type: DealUpdateEventType;
  summary: string;
  proposed_changes: ProposedChanges | null;
  created_at: string;
}

/** Best-effort activity log — mirrors logActivity/logKpActivity in the sibling action files. */
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

/** Count of pending deal_updates visible to the current trusted user — for the top-bar bell badge. */
export async function getPendingDealUpdatesCount(): Promise<number> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("deal_updates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/** Pending deal_updates for the review queue panel, oldest first (work through the backlog in order). */
export async function getPendingDealUpdates(): Promise<PendingDealUpdate[]> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_updates")
    .select(
      "id, deal_id, source, source_ref, event_type, summary, proposed_changes, created_at, deal:deal_id(property_address), author:author_id(full_name)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) return [];

  return ((data ?? []) as unknown as {
    id: string;
    deal_id: string;
    source: DealUpdateSource;
    source_ref: string | null;
    event_type: DealUpdateEventType;
    summary: string;
    proposed_changes: ProposedChanges | null;
    created_at: string;
    deal: { property_address: string } | null;
    author: { full_name: string | null } | null;
  }[]).map((u) => ({
    id: u.id,
    deal_id: u.deal_id,
    deal_address: u.deal?.property_address ?? "—",
    source: u.source,
    source_ref: u.source_ref,
    author_name: u.author?.full_name ?? null,
    event_type: u.event_type,
    summary: u.summary,
    proposed_changes: u.proposed_changes,
    created_at: u.created_at,
  }));
}

/**
 * Apply a pending update's proposed_changes to the deal — ONLY through the
 * existing whitelisted updateDealField path, so EMD stamp-resets, emd_events
 * conflict logging, and waterfall recalcs all behave identically to a manual
 * edit. All-or-nothing: every proposed field's `was` snapshot is compared
 * against the deal's CURRENT value first; if anything drifted since the
 * proposal was created, nothing is applied and the conflicts are returned
 * for the reviewer to see instead of applying blind.
 */
export async function approveDealUpdate(updateId: string): Promise<ApproveResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();

  const { data: row, error: rowError } = await supabase
    .from("deal_updates")
    .select("id, deal_id, status, summary, proposed_changes")
    .eq("id", updateId)
    .maybeSingle();
  if (rowError) return { ok: false, error: rowError.message };
  if (!row) return { ok: false, error: "Update not found." };
  if (row.status !== "pending") return { ok: false, error: `Already ${row.status}.` };

  const proposed = (row.proposed_changes ?? {}) as ProposedChanges;
  const fields = Object.keys(proposed);

  if (fields.length > 0) {
    const unknown = fields.filter((f) => !EDITABLE_FIELDS[f]);
    if (unknown.length > 0) {
      return { ok: false, error: `Not editable: ${unknown.join(", ")}.` };
    }

    const { data: dealRow, error: dealError } = await supabase
      .from("deals")
      .select(fields.join(","))
      .eq("id", row.deal_id)
      .maybeSingle();
    if (dealError) return { ok: false, error: dealError.message };
    if (!dealRow) return { ok: false, error: "Deal not found." };
    const current = dealRow as unknown as Record<string, string | number | null>;

    const conflicts: ApproveConflict[] = fields
      .filter((f) => current[f] !== proposed[f].was)
      .map((f) => ({
        field: f,
        label: EDITABLE_FIELDS[f].label,
        proposedNew: proposed[f].new,
        expectedWas: proposed[f].was,
        currentValue: current[f],
      }));
    if (conflicts.length > 0) {
      return { ok: false, error: "This deal changed since the update was proposed.", conflicts };
    }

    for (const field of fields) {
      const value = proposed[field].new;
      const res = await updateDealField(row.deal_id, field, value == null ? "" : String(value));
      if (!res.ok) return { ok: false, error: `${EDITABLE_FIELDS[field].label}: ${res.error}` };
    }
  }

  const { error: updateError } = await supabase
    .from("deal_updates")
    .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", updateId)
    .eq("status", "pending");
  if (updateError) return { ok: false, error: updateError.message };

  await logActivity(row.deal_id, "deal_update_approved", row.summary);
  revalidatePath("/dashboard/pipeline");
  return { ok: true, applied: fields };
}

/** Reject a pending update — nothing is applied to the deal. */
export async function rejectDealUpdate(updateId: string): Promise<DealUpdateActionState> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deal_updates")
    .update({ status: "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", updateId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Update not found or already reviewed." };

  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

/**
 * Insert a deal note. RLS is the real gate here (trusted users write freely;
 * KPs only as themselves on a deal they're assigned to) — no app-level role
 * check beyond "must be logged in" so this doesn't drift from the policy.
 * Phase C wires the AI classification pass; for now this is a plain insert.
 */
export async function createNote(dealId: string, body: string): Promise<DealUpdateActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authorized." };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Note can't be empty." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("deal_notes")
    .insert({ deal_id: dealId, author_id: user.id, body: trimmed });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
