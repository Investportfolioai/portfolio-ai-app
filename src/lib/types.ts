/**
 * Portfolio AI — domain types.
 *
 * These mirror the LIVE Postgres schema (introspected from the `deals` and
 * `users` tables). If you alter the schema, update this file and
 * `src/lib/deals.ts` together.
 */

/** Deal capital-structure types (enum `public.deal_structure`). */
export type DealStructure =
  | "morby"
  | "ab_bc"
  | "assignment"
  | "creative"
  | "nnn"
  | "seller_finance";

/** Pipeline stages (enum `public.deal_stage`), earliest → exited. */
export type DealStage =
  | "prospecting"
  | "structuring"
  | "loi"
  | "contract"
  | "rehab"
  | "stabilizing"
  | "exited";

/** Exit strategy (enum `public.exit_strategy`). */
export type ExitStrategy = "sell" | "refi" | "hold" | "assignment";

/** Platform roles (enum `public.user_role`). */
export type UserRole = "owner" | "partner" | "kp" | "viewer";

/** KP assignment response status (deal_kps.status). */
export type AssignmentStatus = "pending" | "accepted" | "declined";

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
};

export interface KpAssignment {
  id: string;
  kp_id: string;
  kp_name: string | null;
  kp_email: string | null;
  status: AssignmentStatus;
  responded_at: string | null;
}

export interface AvailableKp {
  id: string;
  full_name: string | null;
  email: string | null;
}

/** A deal as seen by a KP on their dashboard. */
export interface KpDeal {
  assignment_id: string;
  status: AssignmentStatus;
  deal_id: string;
  property_address: string;
  structure_type: DealStructure;
  purchase_price: number | null;
  arv: number | null;
  acquisition_grade: number | null;
  stabilization_grade: number | null;
}

/** A KP's external real-estate holding (kp_sreo). */
export interface KpSreo {
  id: string;
  property_name: string;
  property_type: string | null;
  address: string | null;
  value: number | null;
  mortgage_balance: number | null;
  monthly_payment: number | null;
  created_at: string;
}

/** Lender type (enum `public.lender_type`). */
export type LenderType = "hard_money" | "private" | "institutional" | "seller";

export const LENDER_TYPE_LABELS: Record<LenderType, string> = {
  hard_money: "Hard Money",
  private: "Private",
  institutional: "Institutional",
  seller: "Seller",
};

/** A linked user (owner / co-owner), embedded from the `users` table. */
export interface DealPrincipal {
  id: string;
  full_name: string | null;
  role: UserRole;
  email: string | null;
}

/**
 * A deal row as selected by `src/lib/deals.ts`. Numerics arrive as `number`.
 * `owner` / `coowner` are embedded from `users`; `kp_count` is derived.
 */
export interface Deal {
  id: string;
  property_address: string;
  city: string | null;
  state: string | null;
  structure_type: DealStructure;
  stage: DealStage;

  purchase_price: number | null;
  arv: number | null;
  loan_amount: number | null;
  initial_advance: number | null;
  holdback: number | null;
  interest_rate: number | null;
  ltv: number | null;
  equity_spread: number | null;

  seller_note_amount: number | null;
  seller_note_rate: number | null;
  assignment_fee: number | null;
  origination_fee: number | null;

  /** Underwriting scores, 0–100, nullable (see migration 20260603010003). */
  acquisition_grade: number | null;
  stabilization_grade: number | null;

  exit_strategy: ExitStrategy | null;
  lender_name: string | null;
  quote_number: string | null;
  acquisition_date: string | null;
  projected_close_date: string | null;

  owner_id: string | null;
  coowner_id: string | null;
  owner: DealPrincipal | null;
  coowner: DealPrincipal | null;

  /** Workflow status (migration 20260603010004). */
  status: DealStatus;
  /** When status last changed — drives the dead-deal auto-delete countdown. */
  status_changed_at: string | null;
  /** Set when the deal is moved into the escrow pipeline (Phase 3). */
  escrow_date: string | null;
  /** Cashback captured at close (Phase 3). */
  cashback_at_close: number | null;
  /** Full Claude underwriting output stored from the submit flow (jsonb). */
  ai_analysis: UnderwritingOutput | null;

  ai_summary: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;

  /** Count of KPs attached to this deal (derived; see deals.ts). */
  kp_count: number;
  /** Days until the nearest upcoming milestone (derived; null if none). */
  next_milestone_days: number | null;
}

/** Deal workflow status (enum `public.deal_status`). */
export type DealStatus = "pending" | "active" | "passed" | "dead";

export const STATUS_LABELS: Record<DealStatus, string> = {
  pending: "Pending",
  active: "Active",
  passed: "Passed",
  dead: "Dead",
};

/** Dead deals auto-delete this many days after they were marked dead. */
export const DEAD_DEAL_TTL_DAYS = 120;

// ---------------------------------------------------------------------------
// Milestones (deal_milestones table)
// ---------------------------------------------------------------------------

export type MilestoneType = "emd" | "inspection" | "coe" | "custom";

export const MILESTONE_LABELS: Record<MilestoneType, string> = {
  emd: "Earnest Money",
  inspection: "Inspection Period",
  coe: "Close of Escrow",
  custom: "Custom",
};

export interface DealMilestone {
  id: string;
  deal_id: string;
  label: string;
  target_date: string;
  milestone_type: MilestoneType | null;
  source: "manual" | "ai_extracted" | null;
  created_at: string;
}

/** Whole days from today until an ISO date (negative = past due). */
export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Days left before a dead deal is auto-deleted (null if not dead/unknown). */
export function deadDaysRemaining(
  deal: Pick<Deal, "status" | "status_changed_at">,
): number | null {
  if (deal.status !== "dead" || !deal.status_changed_at) return null;
  return Math.max(0, DEAD_DEAL_TTL_DAYS - daysSince(deal.status_changed_at));
}

// ---------------------------------------------------------------------------
// AI underwriting output (shared client/server shape; stored in deals.ai_analysis)
// ---------------------------------------------------------------------------

export interface ExtractedDealData {
  property_address: string | null;
  city: string | null;
  state: string | null;
  property_type: string | null;
  structure_type: DealStructure | null;
  purchase_price: number | null;
  arv: number | null;
  loan_amount: number | null;
  initial_advance: number | null;
  holdback: number | null;
  interest_rate: number | null;
  ltv: number | null;
  seller_note_amount: number | null;
  seller_note_rate: number | null;
  balloon_term_months: number | null;
  assignment_fee: number | null;
  origination_fee: number | null;
  exit_strategy: ExitStrategy | null;
  lender_name: string | null;
  quote_number: string | null;
  /** Capital Runway Multiple inputs — entered manually or extracted by AI. */
  total_cash_invested: number | null;
  net_monthly_cashflow: number | null;
  annual_gross_revenue?: number | null;
}

export type Recommendation = "proceed" | "proceed_with_conditions" | "decline";

export interface UnderwritingAnalysis {
  recommendation: Recommendation;
  acquisition_grade: number;
  stabilization_grade: number;
  equity_spread: number | null;
  /** Legacy location for CRM inputs (now in extracted_deal_data). */
  total_cash_invested?: number | null;
  net_monthly_cashflow?: number | null;
  summary: string;
  strengths: string[];
  risks: string[];
  conditions: string[];
}

export interface UnderwritingOutput {
  extracted_deal_data: ExtractedDealData;
  /** Null until underwriting has been run (manual deals start un-underwritten). */
  underwriting: UnderwritingAnalysis | null;
}

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  proceed: "Proceed",
  proceed_with_conditions: "Proceed with conditions",
  decline: "Decline",
};

/**
 * Capital Runway Multiple = total cash invested ÷ net monthly cash OUTFLOW
 * after all debt service. If net monthly is positive (cash flowing) → "Cash
 * Flowing". Missing inputs → "—". Displayed to one decimal with an "x" suffix.
 */
export function capitalRunwayMultiple(
  deal: Pick<Deal, "ai_analysis">,
): string {
  const ed = deal.ai_analysis?.extracted_deal_data;
  const uw = deal.ai_analysis?.underwriting;
  // Prefer the deal-fact location; fall back to the legacy underwriting slot.
  const cash = ed?.total_cash_invested ?? uw?.total_cash_invested ?? null;
  const net = ed?.net_monthly_cashflow ?? uw?.net_monthly_cashflow ?? null;
  if (cash == null || net == null) return "—";
  if (net >= 0) return "Cash Flowing";
  return `${(cash / -net).toFixed(1)}x`;
}

/**
 * Equity spread to display. `equity_spread` is a GENERATED column in Postgres
 * (ARV − loan amount); prefer it, and mirror that formula if it's ever null.
 */
export function equitySpread(
  deal: Pick<Deal, "equity_spread" | "arv" | "loan_amount">,
): number | null {
  if (deal.equity_spread != null) return deal.equity_spread;
  if (deal.arv == null || deal.loan_amount == null) return null;
  return deal.arv - deal.loan_amount;
}

/** Whole days since the deal was last updated. */
export function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

export const STRUCTURE_LABELS: Record<DealStructure, string> = {
  morby: "Morby",
  ab_bc: "AB→BC",
  assignment: "Assignment",
  creative: "Creative",
  nnn: "NNN",
  seller_finance: "Seller Finance",
};

export const STAGE_LABELS: Record<DealStage, string> = {
  prospecting: "Prospecting",
  structuring: "Structuring",
  loi: "LOI",
  contract: "Contract",
  rehab: "Rehab",
  stabilizing: "Stabilizing",
  exited: "Exited",
};

export const EXIT_LABELS: Record<ExitStrategy, string> = {
  sell: "Sell",
  refi: "Refinance",
  hold: "Hold",
  assignment: "Assignment",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  partner: "Partner",
  kp: "KP",
  viewer: "Viewer",
};

/** Stage ordering for sorting / column layout. */
export const STAGE_ORDER: DealStage[] = [
  "prospecting",
  "structuring",
  "loi",
  "contract",
  "rehab",
  "stabilizing",
  "exited",
];

/** Tailwind classes for the colored badge per stage. */
export const STAGE_BADGE: Record<DealStage, string> = {
  prospecting: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
  structuring: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
  loi: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/30",
  contract: "bg-[#C9A84C]/15 text-[#E6CE86] ring-[#C9A84C]/40",
  rehab: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  stabilizing: "bg-orange-500/15 text-orange-300 ring-orange-400/30",
  exited: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
};

export const ALL_STRUCTURES = Object.keys(STRUCTURE_LABELS) as DealStructure[];
