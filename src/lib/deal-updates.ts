import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealUpdateSource, DealUpdateEventType, ProposedChanges } from "@/lib/types";

/**
 * Deal Intelligence Engine — write helpers shared by the Gmail scanner (cron,
 * service-role admin client, no session) and any server action that needs to
 * record a proposed/applied change. Everything an automated source produces
 * lands in deal_updates so the review queue and nightly digest can surface it.
 *
 * The auto-apply tier (Automation Push, section 4) writes a field ONLY where
 * the deal's current value is null/empty — so auto-apply never overrides an
 * operator-set value and carries no EMD reminder side-effects (a null→value
 * hard-date has no prior reminders/stamps to reset). Every genuine conflict
 * goes to the pending queue for a one-tap review instead.
 */

export type DocType = "purchase_contract" | "addendum" | "extension" | "appraisal" | "email" | "other";

export interface RecordUpdateParams {
  dealId: string;
  source: DealUpdateSource;
  sourceRef?: string | null;
  docType?: DocType | null;
  documentDate?: string | null;
  eventType: DealUpdateEventType;
  summary: string;
  /** field → { new, was } — `was` is the deal's current value at record time. */
  changes?: ProposedChanges;
}

/** True for a value we treat as "empty" and therefore safe to auto-fill. */
export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

/**
 * Auto-apply: write the field(s) to the deal immediately, record an 'auto'
 * deal_updates row (shows in the queue as done-with-UNDO), and log an
 * "auto-applied" timeline entry. Note-sourced updates are NEVER auto-applied —
 * they are downgraded to pending (section-4 policy) regardless of caller.
 */
export async function recordAutoApply(
  admin: SupabaseClient,
  params: RecordUpdateParams,
): Promise<{ id: string | null; downgraded: boolean }> {
  if (params.source === "note") {
    const id = await recordPending(admin, params);
    return { id, downgraded: true };
  }

  const changes = params.changes ?? {};
  const fields = Object.keys(changes);
  if (fields.length > 0) {
    const patch: Record<string, string | number | string[] | null> = {};
    for (const f of fields) patch[f] = changes[f].new;
    await admin.from("deals").update(patch).eq("id", params.dealId);
  }

  const { data } = await admin
    .from("deal_updates")
    .insert({
      deal_id: params.dealId,
      source: params.source,
      source_ref: params.sourceRef ?? null,
      doc_type: params.docType ?? null,
      document_date: params.documentDate ?? null,
      event_type: params.eventType,
      summary: params.summary,
      proposed_changes: fields.length ? changes : null,
      status: "auto",
    })
    .select("id")
    .single();

  await admin.from("deal_activity").insert({
    deal_id: params.dealId,
    action: "auto_applied",
    note: params.summary,
    created_by: null,
  });

  return { id: data?.id ?? null, downgraded: false };
}

/**
 * Pending: record a 'pending' deal_updates row for one-tap review. Nothing is
 * written to the deal — approval flows through the existing approveDealUpdate
 * → updateDealField whitelist so side-effects and conflict detection behave
 * exactly like a manual edit.
 */
export async function recordPending(
  admin: SupabaseClient,
  params: RecordUpdateParams,
): Promise<string | null> {
  const changes = params.changes ?? {};
  const { data } = await admin
    .from("deal_updates")
    .insert({
      deal_id: params.dealId,
      source: params.source,
      source_ref: params.sourceRef ?? null,
      doc_type: params.docType ?? null,
      document_date: params.documentDate ?? null,
      event_type: params.eventType,
      summary: params.summary,
      proposed_changes: Object.keys(changes).length ? changes : null,
      status: "pending",
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

/**
 * Waiting-on marker (section 5): a pending-STATE flag, not a data change —
 * status 'auto', event_type 'task', summary "WAITING ON …". Feeds the digest
 * pending section and clears (status 'cleared') when a matching inbound/doc
 * arrives or an operator dismisses it. Deduped by caller against open markers.
 */
export async function recordWaitingOn(
  admin: SupabaseClient,
  params: { dealId: string; source: DealUpdateSource; sourceRef?: string | null; summary: string },
): Promise<string | null> {
  const { data } = await admin
    .from("deal_updates")
    .insert({
      deal_id: params.dealId,
      source: params.source,
      source_ref: params.sourceRef ?? null,
      event_type: "task",
      summary: params.summary,
      status: "auto",
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

/**
 * Clear (resolve) every open waiting-on marker on a deal — called when a
 * matching inbound reply or signed document arrives (section 5). Sets status
 * 'cleared' + resolved_ref so it drops out of the pending digest section but
 * remains in history for the weekly "completed" roll-up. Returns how many
 * markers were cleared.
 */
export async function clearWaitingOn(
  admin: SupabaseClient,
  dealId: string,
  resolvedRef: string,
): Promise<number> {
  const { data } = await admin
    .from("deal_updates")
    .update({ status: "cleared", resolved_ref: resolvedRef, reviewed_at: new Date().toISOString() })
    .eq("deal_id", dealId)
    .eq("status", "auto")
    .eq("event_type", "task")
    .select("id");
  return data?.length ?? 0;
}

/** Timeline-only communication entry (no queue row, no field write). */
export async function recordCommunication(
  admin: SupabaseClient,
  params: { dealId: string; note: string },
): Promise<void> {
  await admin.from("deal_activity").insert({
    deal_id: params.dealId,
    action: "communication",
    note: params.note,
    created_by: null,
  });
}
