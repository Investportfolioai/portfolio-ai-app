import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const EARLY_STAGES = new Set(["loi", "purchase_contract"]);

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
