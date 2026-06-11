import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import type { KpSreo, AssignmentStatus, DealStructure } from "@/lib/types";
import { KpDashboardClient, type KpDealRich } from "./kp-dashboard-client";

export const metadata = { title: "My Dashboard — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function KpDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const [{ data: assignmentRows }, { data: sreoRows }] = await Promise.all([
    supabase
      .from("deal_kps")
      .select(
        "id, status, deal:deal_id(id, property_address, structure_type, purchase_price, arv, acquisition_grade, stabilization_grade, status, cashback_at_close, escrow_date, created_at)",
      )
      .eq("kp_id", user.id)
      .order("assigned_at", { ascending: false }),
    supabase
      .from("kp_sreo")
      .select(
        "id, property_name, property_type, address, value, mortgage_balance, monthly_payment, created_at",
      )
      .eq("kp_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const deals: KpDealRich[] = ((assignmentRows ?? []) as unknown as {
    id: string;
    status: AssignmentStatus | null;
    deal: {
      id: string;
      property_address: string;
      structure_type: DealStructure;
      purchase_price: number | null;
      arv: number | null;
      acquisition_grade: number | null;
      stabilization_grade: number | null;
      status: string | null;
      cashback_at_close: number | null;
      escrow_date: string | null;
      created_at: string | null;
    } | null;
  }[])
    .filter((r) => r.deal)
    .map((r) => ({
      assignment_id: r.id,
      status: r.status ?? "pending",
      deal_id: r.deal!.id,
      property_address: r.deal!.property_address,
      structure_type: r.deal!.structure_type,
      purchase_price: r.deal!.purchase_price,
      arv: r.deal!.arv,
      acquisition_grade: r.deal!.acquisition_grade,
      stabilization_grade: r.deal!.stabilization_grade,
      deal_status: r.deal!.status,
      cashback_at_close: r.deal!.cashback_at_close,
      escrow_date: r.deal!.escrow_date,
      deal_created_at: r.deal!.created_at,
    }));

  const sreo = (sreoRows ?? []) as KpSreo[];

  return (
    <KpDashboardClient
      profile={{
        name: user.full_name,
        email: user.email,
        role: user.role,
        entity: user.entity_name,
      }}
      deals={deals}
      sreo={sreo}
    />
  );
}
