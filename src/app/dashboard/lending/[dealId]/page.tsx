import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { seedDealChecklist, seedDealReadinessDocs, getDealGmailThreads, isGmailConfigured } from "../lending-actions";
import type { GmailThread } from "@/lib/gmail";
import { LendingDetailClient } from "./lending-detail-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("deals")
    .select("property_address")
    .eq("id", dealId)
    .maybeSingle();
  return { title: data ? `${data.property_address} — Lending` : "Lending — Portfolio AI" };
}

export type ChecklistItem = {
  id: string;
  stage: string;
  position: number;
  item_text: string;
  completed: boolean;
  completed_at: string | null;
};

export type ReadinessDoc = {
  id: string;
  doc_name: string;
  asset_class: string;
  received: boolean;
  received_at: string | null;
  position: number;
};

export type { GmailThread };

export type AddendumDraft = {
  id: string;
  title: string | null;
  content: string;
  status: string;
  version: number;
  created_at: string;
};

const LENDING_STAGES = [
  "loi",
  "purchase_contract",
  "emd_setup",
  "lender_submission",
  "appraisal_insurance",
  "clear_to_close",
  "closed",
] as const;

async function LendingDetailContent({ dealId }: { dealId: string }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

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

  // Auto-seed on first view (idempotent)
  await Promise.all([
    seedDealChecklist(dealId),
    seedDealReadinessDocs(dealId, assetClass),
  ]);

  const [{ data: checklistRows }, { data: readinessRows }, { data: drafts }, gmailResult] = await Promise.all([
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
    getDealGmailThreads({
      lenderName: (deal as { lender_name: string | null }).lender_name,
      propertyAddress: (deal as { property_address: string }).property_address,
    }),
  ]);

  const checklist = (checklistRows ?? []) as ChecklistItem[];
  const readinessDocs = (readinessRows ?? []) as ReadinessDoc[];
  const addendumDrafts = (drafts ?? []) as AddendumDraft[];
  const gmailThreads = gmailResult.threads;
  const gmailConfigured = gmailResult.configured;

  // Group checklist by stage preserving order
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
      gmailThreads={gmailThreads}
      gmailConfigured={gmailConfigured}
    />
  );
}

function DetailSkeleton() {
  return (
    <div style={{ padding: "32px 24px" }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            background: "rgba(255,255,255,0.04)",
            borderRadius: "12px",
            height: "56px",
            marginBottom: "8px",
            animation: "pulse 2s infinite",
          }}
        />
      ))}
    </div>
  );
}

export default async function LendingDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <LendingDetailContent dealId={dealId} />
    </Suspense>
  );
}
