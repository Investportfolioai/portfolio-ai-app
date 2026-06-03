import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Deal, DealPrincipal, DealStatus, UnderwritingOutput, UserRole } from "@/lib/types";

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

// ---------------------------------------------------------------------------
// Page-data helpers (sidebar sections)
// ---------------------------------------------------------------------------

export interface KeyPrincipal {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  entity_name: string | null;
}

/** All users with the `kp` role (Key Principals page). */
export async function getKeyPrincipals(): Promise<KeyPrincipal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, entity_name")
    .eq("role", "kp")
    .order("full_name");
  if (error) return [];
  return (data ?? []) as KeyPrincipal[];
}

export interface DealDocument {
  id: string;
  file_name: string;
  file_type: string | null;
  uploaded_at: string;
  deal_address: string;
  url: string | null;
}

/** All documents across deals, with signed download URLs (Documents page). */
export async function getAllDocuments(): Promise<DealDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_documents")
    .select("id, file_name, file_type, uploaded_at, file_url, deal:deal_id(property_address)")
    .order("uploaded_at", { ascending: false });
  if (error) return [];

  const admin = createAdminClient();
  const rows = (data ?? []) as unknown as {
    id: string;
    file_name: string;
    file_type: string | null;
    uploaded_at: string;
    file_url: string;
    deal: { property_address: string } | null;
  }[];

  return Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await admin.storage
        .from("deal-documents")
        .createSignedUrl(r.file_url, 60 * 60);
      return {
        id: r.id,
        file_name: r.file_name,
        file_type: r.file_type,
        uploaded_at: r.uploaded_at,
        deal_address: r.deal?.property_address ?? "—",
        url: signed?.signedUrl ?? null,
      };
    }),
  );
}
