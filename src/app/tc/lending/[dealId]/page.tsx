import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { LendingDetailClient } from "@/app/dashboard/lending/[dealId]/lending-detail-client";
import type { ChecklistItem, ReadinessDoc, AddendumDraft } from "@/app/dashboard/lending/[dealId]/page";
import { seedDealChecklist, seedDealReadinessDocs } from "@/app/dashboard/lending/lending-actions";

export const dynamic = "force-dynamic";

const LENDING_STAGES = [
  "loi",
  "purchase_contract",
  "emd_setup",
  "lender_submission",
  "appraisal_insurance",
  "clear_to_close",
  "closed",
] as const;

async function TcLendingContent({ dealId }: { dealId: string }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "tc") redirect("/dashboard");

  const supabase = await createClient();

  // Verify TC has access to this deal and the lending tab
  const [{ data: dealAccess }, { data: tabAccess }] = await Promise.all([
    supabase.from("deal_tcs").select("deal_id").eq("deal_id", dealId).eq("tc_id", user.id).maybeSingle(),
    supabase.from("tc_tab_grants").select("tab").eq("tc_id", user.id).eq("tab", "lending").maybeSingle(),
  ]);

  if (!dealAccess || !tabAccess) notFound();

  const { data: deal } = await supabase
    .from("deals")
    .select("id, property_address, stage, status, lender_name, ai_analysis, purchase_price")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal) notFound();

  const assetType: string =
    (deal as { ai_analysis?: { extracted_deal_data?: { property_type?: string } } | null })
      .ai_analysis?.extracted_deal_data?.property_type ?? "";

  const assetClass: "commercial" | "residential" =
    assetType.toLowerCase() === "commercial" ? "commercial" : "residential";

  // Seed on first view (idempotent — owner-level server action)
  await Promise.all([
    seedDealChecklist(dealId),
    seedDealReadinessDocs(dealId, assetClass),
  ]);

  const [{ data: checklistRows }, { data: readinessRows }, { data: drafts }] = await Promise.all([
    supabase
      .from("lending_checklist_items")
      .select("id, stage, position, item_text, completed, completed_at")
      .eq("deal_id", dealId)
      .order("stage")
      .order("position"),
    supabase
      .from("lender_readiness_docs")
      .select("id, doc_name, asset_class, received, received_at, position")
      .eq("deal_id", dealId)
      .order("position"),
    supabase
      .from("addendum_drafts")
      .select("id, title, content, status, version, created_at")
      .eq("deal_id", dealId)
      .order("version", { ascending: false }),
  ]);

  const checklist = (checklistRows ?? []) as ChecklistItem[];
  const readinessDocs = (readinessRows ?? []) as ReadinessDoc[];
  const addendumDrafts = (drafts ?? []) as AddendumDraft[];

  const byStage = new Map<string, ChecklistItem[]>();
  for (const stage of LENDING_STAGES) byStage.set(stage, []);
  for (const item of checklist) {
    const list = byStage.get(item.stage) ?? [];
    list.push(item);
    byStage.set(item.stage, list);
  }

  return (
    <LendingDetailClient
      deal={{
        id: deal.id,
        property_address: (deal as { property_address: string }).property_address,
        stage: (deal as { stage: string }).stage,
        lender_name: (deal as { lender_name: string | null }).lender_name,
        asset_type: assetType,
        asset_class: assetClass,
      }}
      checklistByStage={Object.fromEntries(byStage)}
      stageOrder={LENDING_STAGES as unknown as string[]}
      readinessDocs={readinessDocs}
      addendumDrafts={addendumDrafts}
      gmailThreads={[]}
      gmailConfigured={false}
    />
  );
}

export default async function TcLendingDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return (
    <Suspense fallback={<div style={{ padding: "32px 24px" }}><div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "12px", height: "200px", animation: "pulse 2s infinite" }} /></div>}>
      <TcLendingContent dealId={dealId} />
    </Suspense>
  );
}
