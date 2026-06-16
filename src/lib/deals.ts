import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { daysUntil } from "@/lib/types";
import type { Deal, DealPrincipal, DealStatus, LenderType, UnderwritingOutput, UserRole } from "@/lib/types";

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
  tc_fee, attorney_fee, pm_fee, dpts_override, wholesaler_name,
  owner:owner_id(${PRINCIPAL}),
  coowner:coowner_id(${PRINCIPAL})
`;

const WITH_STATUS = `${BASE_COLUMNS}, status, ai_analysis`;
const WITH_GRADES = `${WITH_STATUS}, acquisition_grade, stabilization_grade`;
const WITH_TIMELINE = `${WITH_GRADES}, status_changed_at, escrow_date, cashback_at_close, rental_strategy, deal_milestones(target_date)`;
const FULL_COLUMNS = `${WITH_TIMELINE}, deal_kps(count)`;

type DealRow = Omit<
  Deal,
  | "owner"
  | "coowner"
  | "kp_count"
  | "next_milestone_days"
  | "status"
  | "status_changed_at"
  | "escrow_date"
  | "cashback_at_close"
  | "rental_strategy"
  | "ai_analysis"
  | "acquisition_grade"
  | "stabilization_grade"
> & {
  owner: DealPrincipal | null;
  coowner: DealPrincipal | null;
  deal_kps?: { count: number }[];
  deal_milestones?: { target_date: string }[];
  status?: DealStatus;
  status_changed_at?: string | null;
  escrow_date?: string | null;
  cashback_at_close?: number | null;
  rental_strategy?: "ltr" | "str" | null;
  ai_analysis?: UnderwritingOutput | null;
  acquisition_grade?: number | null;
  stabilization_grade?: number | null;
};

function normalize(row: DealRow): Deal {
  const {
    deal_kps,
    deal_milestones,
    status,
    status_changed_at,
    escrow_date,
    cashback_at_close,
    rental_strategy,
    ai_analysis,
    acquisition_grade,
    stabilization_grade,
    ...rest
  } = row;
  const upcoming = (deal_milestones ?? [])
    .map((m) => daysUntil(m.target_date))
    .filter((d) => d >= 0);
  return {
    ...rest,
    status: status ?? "pending",
    status_changed_at: status_changed_at ?? null,
    escrow_date: escrow_date ?? null,
    cashback_at_close: cashback_at_close ?? null,
    rental_strategy: rental_strategy ?? "ltr",
    ai_analysis: ai_analysis ?? null,
    acquisition_grade: acquisition_grade ?? null,
    stabilization_grade: stabilization_grade ?? null,
    kp_count: deal_kps?.[0]?.count ?? 0,
    next_milestone_days: upcoming.length ? Math.min(...upcoming) : null,
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

  // deal_kps not present — still read status_changed_at + grades.
  const withTimeline = await supabase
    .from("deals")
    .select(WITH_TIMELINE)
    .order("updated_at", { ascending: false });
  if (!withTimeline.error)
    return (withTimeline.data as unknown as DealRow[]).map(normalize);

  // status_changed_at not present — still read grades.
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

  const withTimeline = await supabase
    .from("deals")
    .select(WITH_TIMELINE)
    .eq("id", id)
    .maybeSingle();
  if (!withTimeline.error && withTimeline.data)
    return normalize(withTimeline.data as unknown as DealRow);

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
  deals_count: number;
  capital_exposure: number;
}

/** KPs with attached-deal counts and total capital exposure (via deal_kps). */
export async function getKeyPrincipals(): Promise<KeyPrincipal[]> {
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, entity_name")
    .eq("role", "kp")
    .order("full_name");
  if (error) return [];

  const { data: links } = await supabase
    .from("deal_kps")
    .select("kp_id, deal:deal_id(ai_analysis)");
  const byKp = new Map<string, { count: number; exposure: number }>();
  for (const l of (links ?? []) as unknown as {
    kp_id: string;
    deal: { ai_analysis: UnderwritingOutput | null } | null;
  }[]) {
    const ed = l.deal?.ai_analysis?.extracted_deal_data;
    const uw = l.deal?.ai_analysis?.underwriting;
    const cash = ed?.total_cash_invested ?? uw?.total_cash_invested ?? 0;
    const cur = byKp.get(l.kp_id) ?? { count: 0, exposure: 0 };
    cur.count += 1;
    cur.exposure += cash ?? 0;
    byKp.set(l.kp_id, cur);
  }

  return ((users ?? []) as Omit<KeyPrincipal, "deals_count" | "capital_exposure">[]).map(
    (u) => ({
      ...u,
      deals_count: byKp.get(u.id)?.count ?? 0,
      capital_exposure: byKp.get(u.id)?.exposure ?? 0,
    }),
  );
}

export interface Lender {
  id: string;
  name: string;
  type: LenderType | null;
  rate: number | null;
  max_ltv: number | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
}

/** All lenders (Lenders page). */
export async function getLenders(): Promise<Lender[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lenders")
    .select("id, name, type, rate, max_ltv, contact_name, phone, email")
    .order("name");
  if (error) return [];
  return (data ?? []) as Lender[];
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

export interface RecentActivity {
  id: string;
  action: string;
  note: string | null;
  created_at: string;
  deal_address: string;
}

/** Last N activity entries across all deals (dashboard feed). */
export async function getRecentActivity(limit = 10): Promise<RecentActivity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_activity")
    .select("id, action, note, created_at, deal:deal_id(property_address)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as unknown as {
    id: string;
    action: string;
    note: string | null;
    created_at: string;
    deal: { property_address: string } | null;
  }[]).map((r) => ({
    id: r.id,
    action: r.action,
    note: r.note,
    created_at: r.created_at,
    deal_address: r.deal?.property_address ?? "—",
  }));
}

export interface TransactionCoordinator {
  id: string;
  full_name: string | null;
  email: string | null;
  tabs: string[];
  deals_count: number;
}

/** All TCs with their granted tabs and deal counts. */
export async function getTransactionCoordinators(): Promise<TransactionCoordinator[]> {
  const supabase = await createClient();
  const [{ data: users }, { data: tabs }, { data: deals }] = await Promise.all([
    supabase.from("users").select("id, full_name, email").eq("role", "tc").order("full_name"),
    supabase.from("tc_tab_grants").select("tc_id, tab"),
    supabase.from("deal_tcs").select("tc_id"),
  ]);

  const tabMap = new Map<string, string[]>();
  for (const t of (tabs ?? [])) {
    const list = tabMap.get(t.tc_id) ?? [];
    list.push(t.tab);
    tabMap.set(t.tc_id, list);
  }

  const countMap = new Map<string, number>();
  for (const d of (deals ?? [])) {
    countMap.set(d.tc_id, (countMap.get(d.tc_id) ?? 0) + 1);
  }

  return ((users ?? []) as { id: string; full_name: string | null; email: string | null }[]).map(
    (u) => ({
      ...u,
      tabs: tabMap.get(u.id) ?? [],
      deals_count: countMap.get(u.id) ?? 0,
    }),
  );
}

/** Active deals list for the TC invite modal (id + address only). */
export async function getActiveDealsForTcInvite(): Promise<{ id: string; property_address: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deals")
    .select("id, property_address")
    .in("status", ["active", "pending"])
    .order("property_address");
  return (data ?? []) as { id: string; property_address: string }[];
}

/** Milestones for a deal, soonest target first. */
export async function getDealMilestones(dealId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_milestones")
    .select("id, deal_id, label, target_date, milestone_type, source, created_at")
    .eq("deal_id", dealId)
    .order("target_date", { ascending: true });
  if (error) return [];
  return data ?? [];
}
