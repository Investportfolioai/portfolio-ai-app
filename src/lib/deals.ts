import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Deal, DealPrincipal, DealStatus, UnderwritingOutput } from "@/lib/types";

/**
 * Data access for the deal pipeline. All raw column/relation names live here
 * and in `src/lib/types.ts`.
 *
 * Selects degrade gracefully: the full select pulls grades, status, ai_analysis
 * and the KP count (migrations 20260603010001/3/4). If those aren't applied yet
 * the query errors and we fall back to a base select with sane defaults
 * (status -> "pending", ai_analysis -> null, grades -> null, kp_count -> 0).
 *
 * Access is enforced by RLS via the session-scoped server client.
 */

const PRINCIPAL = "id, full_name, role, email";

const BASE_COLUMNS = `
  id, property_address, city, state, structure_type, stage,
  purchase_price, arv, loan_amount, initial_advance, holdback,
  interest_rate, ltv, equity_spread, seller_note_amount, seller_note_rate,
  assignment_fee, origination_fee, exit_strategy, lender_name, quote_number,
  acquisition_date, projected_close_date, owner_id, coowner_id,
  ai_summary, notes, created_at, updated_at,
  owner:owner_id(${PRINCIPAL}),
  coowner:coowner_id(${PRINCIPAL})
`;

const WITH_STATUS = `${BASE_COLUMNS}, status, ai_analysis`;
const WITH_GRADES = `${WITH_STATUS}, acquisition_grade, stabilization_grade`;
const FULL_COLUMNS = `${WITH_GRADES}, deal_kps(count)`;

type DealRow = Omit<
  Deal,
  | "owner"
  | "coowner"
  | "kp_count"
  | "status"
  | "ai_analysis"
  | "acquisition_grade"
  | "stabilization_grade"
> & {
  owner: DealPrincipal | null;
  coowner: DealPrincipal | null;
  deal_kps?: { count: number }[];
  status?: DealStatus;
  ai_analysis?: UnderwritingOutput | null;
  acquisition_grade?: number | null;
  stabilization_grade?: number | null;
};

function normalize(row: DealRow): Deal {
  const { deal_kps, status, ai_analysis, acquisition_grade, stabilization_grade, ...rest } =
    row;
  return {
    ...rest,
    status: status ?? "pending",
    ai_analysis: ai_analysis ?? null,
    acquisition_grade: acquisition_grade ?? null,
    stabilization_grade: stabilization_grade ?? null,
    kp_count: deal_kps?.[0]?.count ?? 0,
  };
}

/** Fetch all deals visible to the current user, newest-updated first. */
export async function getDeals(): Promise<Deal[]> {
  const supabase = await createClient();

  const full = await supabase
    .from("deals")
    .select(FULL_COLUMNS)
    .order("updated_at", { ascending: false });
  if (!full.error) return (full.data as unknown as DealRow[]).map(normalize);

  // deal_kps not present — still read grades.
  const withGrades = await supabase
    .from("deals")
    .select(WITH_GRADES)
    .order("updated_at", { ascending: false });
  if (!withGrades.error) return (withGrades.data as unknown as DealRow[]).map(normalize);

  // grades not present either — still read status + ai_analysis.
  const withStatus = await supabase
    .from("deals")
    .select(WITH_STATUS)
    .order("updated_at", { ascending: false });
  if (!withStatus.error) return (withStatus.data as unknown as DealRow[]).map(normalize);

  const base = await supabase
    .from("deals")
    .select(BASE_COLUMNS)
    .order("updated_at", { ascending: false });
  if (base.error) {
    console.error("getDeals failed:", base.error.message);
    return [];
  }
  return (base.data as unknown as DealRow[]).map(normalize);
}

/** Fetch a single deal by id, or null if not found / not permitted. */
export async function getDealById(id: string): Promise<Deal | null> {
  const supabase = await createClient();

  const full = await supabase
    .from("deals")
    .select(FULL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!full.error && full.data) return normalize(full.data as unknown as DealRow);

  const withGrades = await supabase
    .from("deals")
    .select(WITH_GRADES)
    .eq("id", id)
    .maybeSingle();
  if (!withGrades.error && withGrades.data)
    return normalize(withGrades.data as unknown as DealRow);

  const withStatus = await supabase
    .from("deals")
    .select(WITH_STATUS)
    .eq("id", id)
    .maybeSingle();
  if (!withStatus.error && withStatus.data)
    return normalize(withStatus.data as unknown as DealRow);

  const base = await supabase
    .from("deals")
    .select(BASE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (base.error || !base.data) return null;
  return normalize(base.data as unknown as DealRow);
}
