import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LendingBoard } from "./lending-board";

export const metadata = { title: "Lending — Portfolio AI" };
export const dynamic = "force-dynamic";

export type LendingDeal = {
  id: string;
  property_address: string;
  stage: string;
  status: string;
  lender_name: string | null;
  asset_type: string | null;
  checklist_total: number;
  checklist_done: number;
  readiness_total: number;
  readiness_done: number;
};

async function LendingContent() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const { data: deals } = await supabase
    .from("deals")
    .select("id, property_address, stage, status, lender_name, ai_analysis")
    .in("status", ["active", "pending"])
    .order("property_address");

  const dealIds = (deals ?? []).map((d) => d.id);

  const [{ data: checklistRows }, { data: readinessRows }] = await Promise.all([
    dealIds.length
      ? supabase
          .from("lending_checklist_items")
          .select("deal_id, completed")
          .in("deal_id", dealIds)
      : Promise.resolve({ data: [] }),
    dealIds.length
      ? supabase
          .from("lender_readiness_docs")
          .select("deal_id, received")
          .in("deal_id", dealIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Build per-deal summary maps
  const checkMap = new Map<string, { total: number; done: number }>();
  for (const r of (checklistRows ?? []) as { deal_id: string; completed: boolean }[]) {
    const cur = checkMap.get(r.deal_id) ?? { total: 0, done: 0 };
    cur.total += 1;
    if (r.completed) cur.done += 1;
    checkMap.set(r.deal_id, cur);
  }

  const readyMap = new Map<string, { total: number; done: number }>();
  for (const r of (readinessRows ?? []) as { deal_id: string; received: boolean }[]) {
    const cur = readyMap.get(r.deal_id) ?? { total: 0, done: 0 };
    cur.total += 1;
    if (r.received) cur.done += 1;
    readyMap.set(r.deal_id, cur);
  }

  const lendingDeals: LendingDeal[] = ((deals ?? []) as {
    id: string;
    property_address: string;
    stage: string;
    status: string;
    lender_name: string | null;
    ai_analysis: { extracted_deal_data?: { property_type?: string } } | null;
  }[]).map((d) => ({
    id: d.id,
    property_address: d.property_address,
    stage: d.stage,
    status: d.status,
    lender_name: d.lender_name,
    asset_type: d.ai_analysis?.extracted_deal_data?.property_type ?? null,
    checklist_total: checkMap.get(d.id)?.total ?? 0,
    checklist_done: checkMap.get(d.id)?.done ?? 0,
    readiness_total: readyMap.get(d.id)?.total ?? 0,
    readiness_done: readyMap.get(d.id)?.done ?? 0,
  }));

  return <LendingBoard deals={lendingDeals} />;
}

function LendingSkeleton() {
  return (
    <div style={{ padding: "32px 24px" }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            background: "rgba(255,255,255,0.04)",
            borderRadius: "12px",
            height: "72px",
            marginBottom: "8px",
            animation: "pulse 2s infinite",
          }}
        />
      ))}
    </div>
  );
}

export default function LendingPage() {
  return (
    <Suspense fallback={<LendingSkeleton />}>
      <LendingContent />
    </Suspense>
  );
}
