import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Deal, DealPrincipal } from "@/lib/types";

/**
 * Data access for the deal pipeline. All raw column/relation names live here
 * and in `src/lib/types.ts`.
 *
 * Live schema:
 *   deals(id, property_address, city, state, structure_type, stage,
 *         purchase_price, arv, loan_amount, initial_advance, holdback,
 *         interest_rate, ltv, equity_spread, seller_note_amount,
 *         seller_note_rate, assignment_fee, origination_fee, exit_strategy,
 *         lender_name, quote_number, acquisition_date, projected_close_date,
 *         owner_id -> users.id, coowner_id -> users.id, ai_summary, notes,
 *         created_at, updated_at)
 *   users(id, email, full_name, role, phone, entity_name, created_at)
 *
 * `kp_count` comes from the `deal_kps` join table (see
 * supabase/migrations/20260603010001_deal_kps.sql). Until that migration is applied the
 * embed errors, and we fall back to a plain select with `kp_count: 0`.
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

const COLUMNS_WITH_KP = `${BASE_COLUMNS}, deal_kps(count)`;

/** PostgREST embeds to-one relations as a single object (or null). */
type DealRow = Omit<Deal, "owner" | "coowner" | "kp_count"> & {
  owner: DealPrincipal | null;
  coowner: DealPrincipal | null;
  deal_kps?: { count: number }[];
};

function normalize(row: DealRow): Deal {
  const { deal_kps, ...rest } = row;
  return { ...rest, kp_count: deal_kps?.[0]?.count ?? 0 };
}

/** Fetch all deals visible to the current user, newest-updated first. */
export async function getDeals(): Promise<Deal[]> {
  const supabase = await createClient();

  const withKp = await supabase
    .from("deals")
    .select(COLUMNS_WITH_KP)
    .order("updated_at", { ascending: false });

  if (!withKp.error) {
    return (withKp.data as unknown as DealRow[]).map(normalize);
  }

  // deal_kps not present yet — fall back without the KP count.
  const plain = await supabase
    .from("deals")
    .select(BASE_COLUMNS)
    .order("updated_at", { ascending: false });

  if (plain.error) {
    console.error("getDeals failed:", plain.error.message);
    return [];
  }

  return (plain.data as unknown as DealRow[]).map(normalize);
}

/** Fetch a single deal by id, or null if not found / not permitted. */
export async function getDealById(id: string): Promise<Deal | null> {
  const supabase = await createClient();

  const withKp = await supabase
    .from("deals")
    .select(COLUMNS_WITH_KP)
    .eq("id", id)
    .maybeSingle();

  if (!withKp.error && withKp.data) {
    return normalize(withKp.data as unknown as DealRow);
  }

  const plain = await supabase
    .from("deals")
    .select(BASE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (plain.error || !plain.data) return null;
  return normalize(plain.data as unknown as DealRow);
}
