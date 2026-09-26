import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const EARLY_STAGES = new Set(["loi", "purchase_contract"]);

export const LENDING_STAGES = [
  "loi",
  "purchase_contract",
  "emd_setup",
  "lender_submission",
  "appraisal_insurance",
  "clear_to_close",
  "closed",
] as const;

/**
 * Effective lending stage: the earliest stage with an incomplete item, else
 * 'closed' once every seeded stage is fully complete, else 'loi' when nothing
 * has been seeded yet. Shared by the Lending detail page and the nightly
 * digest (Transaction Intelligence, Section 4) so both agree on "current stage."
 */
export function computeAutoStage(
  byStage: Map<string, { completed: boolean }[]>,
  stageOrder: readonly string[] = LENDING_STAGES,
): string {
  let hasAnyItems = false;
  for (const stage of stageOrder) {
    const items = byStage.get(stage) ?? [];
    if (items.length === 0) continue;
    hasAnyItems = true;
    if (!items.every((i) => i.completed)) return stage;
  }
  return hasAnyItems ? "closed" : "loi";
}

/** Seed checklist from templates for a deal. Idempotent — no-ops if already seeded.
 *  Pass markEarlyStagesComplete=true at escrow time to pre-complete LOI + Purchase Contract. */
export async function seedDealChecklistAdmin(
  dealId: string,
  markEarlyStagesComplete = false,
): Promise<void> {
  const admin = createAdminClient();

  const { count } = await admin
    .from("lending_checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  if ((count ?? 0) > 0) return;

  const { data: templates } = await admin
    .from("lending_checklist_templates")
    .select("stage, position, item_text")
    .order("stage")
    .order("position");

  if (!templates?.length) return;

  const now = new Date().toISOString();
  await admin.from("lending_checklist_items").insert(
    templates.map((t) => ({
      deal_id: dealId,
      stage: t.stage,
      position: t.position,
      item_text: t.item_text,
      completed: markEarlyStagesComplete && EARLY_STAGES.has(t.stage),
      completed_at:
        markEarlyStagesComplete && EARLY_STAGES.has(t.stage) ? now : null,
    })),
  );
}

/** Seed lender readiness docs from templates for a deal. Idempotent. */
export async function seedDealReadinessDocsAdmin(
  dealId: string,
  assetClass: "commercial" | "residential",
): Promise<void> {
  const admin = createAdminClient();

  const { count } = await admin
    .from("lender_readiness_docs")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  if ((count ?? 0) > 0) return;

  const { data: templates } = await admin
    .from("lender_readiness_templates")
    .select("doc_name, position")
    .eq("asset_class", assetClass)
    .order("position");

  if (!templates?.length) return;

  await admin.from("lender_readiness_docs").insert(
    templates.map((t) => ({
      deal_id: dealId,
      doc_name: t.doc_name,
      asset_class: assetClass,
      position: t.position,
    })),
  );
}
