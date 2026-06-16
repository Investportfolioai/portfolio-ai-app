import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { TcDashboardClient, type TcDeal } from "./tc-dashboard-client";

export const metadata = { title: "TC Dashboard — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function TcDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "tc") redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: tabRows }, { data: dealRows }] = await Promise.all([
    supabase.from("tc_tab_grants").select("tab").eq("tc_id", user.id),
    supabase
      .from("deal_tcs")
      .select(
        "deal_id, deal:deal_id(id, property_address, stage, status, ai_analysis)",
      )
      .eq("tc_id", user.id),
  ]);

  const tabs = (tabRows ?? []).map((r) => r.tab as string);

  const deals: TcDeal[] = ((dealRows ?? []) as unknown as {
    deal_id: string;
    deal: {
      id: string;
      property_address: string;
      stage: string;
      status: string;
      ai_analysis: { extracted_deal_data?: { property_type?: string } } | null;
    } | null;
  }[])
    .filter((r) => r.deal)
    .map((r) => ({
      deal_id: r.deal!.id,
      property_address: r.deal!.property_address,
      stage: r.deal!.stage,
      status: r.deal!.status,
      asset_type: r.deal!.ai_analysis?.extracted_deal_data?.property_type ?? null,
    }));

  return (
    <TcDashboardClient
      profile={{ name: user.full_name, email: user.email }}
      tabs={tabs}
      deals={deals}
    />
  );
}
