import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortfolioClient, type PortfolioDeal } from "./portfolio-client";

export const metadata = { title: "Portfolio — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // cashback_at_close / escrow_date come from the Phase-3 migration; if it
  // hasn't been applied yet the select errors and both lists stay empty
  // (Holdings still works), rather than crashing the page.
  let pending: PortfolioDeal[] = [];
  let escrow: PortfolioDeal[] = [];
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, property_address, purchase_price, arv, acquisition_grade, stabilization_grade, created_at, status, cashback_at_close, escrow_date",
    )
    .in("status", ["pending", "active"])
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[portfolio] deals select failed:", error.message);
  } else {
    const rows = (data ?? []) as PortfolioDeal[];
    pending = rows.filter((d) => d.status === "pending");
    escrow = rows.filter((d) => d.status === "active" && d.escrow_date);
  }

  return <PortfolioClient pending={pending} escrow={escrow} />;
}
