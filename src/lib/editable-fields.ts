/**
 * The updateDealField whitelist (src/app/dashboard/pipeline/actions.ts) and
 * its field labels. Lives outside any "use server" module so it can be
 * imported by both server actions and client components (a "use server"
 * file may only export async functions — a plain object export would fail
 * the Next.js build).
 */
export const EDITABLE_FIELDS: Record<string, { label: string; numeric: boolean; date?: boolean }> = {
  property_address: { label: "Address", numeric: false },
  purchase_price: { label: "Purchase Price", numeric: true },
  arv: { label: "ARV", numeric: true },
  loan_amount: { label: "Loan Amount", numeric: true },
  ltv_percent: { label: "LTV %", numeric: true },
  seller_note_amount: { label: "Seller Note Balance", numeric: true },
  assignment_fee: { label: "Assignment Fee", numeric: true },
  interest_rate: { label: "Interest Rate", numeric: true },
  holdback: { label: "Holdback", numeric: true },
  lender_name: { label: "Lender", numeric: false },
  quote_number: { label: "Quote #", numeric: false },
  notes: { label: "Notes", numeric: false },
  // Cost inputs for waterfall / cashflow underwriting
  realtor_commission: { label: "Realtor Commission", numeric: true },
  insurance_annual: { label: "Insurance (Annual)", numeric: true },
  taxes_annual: { label: "Taxes (Annual)", numeric: true },
  hoa_monthly: { label: "HOA (Monthly)", numeric: true },
  first_lien_monthly: { label: "First Lien / mo", numeric: true },
  seller_carry_monthly: { label: "Seller Carry / mo", numeric: true },
  // Closing cost fees (subtracted before credit partner split)
  tc_fee: { label: "TC Fee", numeric: true },
  attorney_fee: { label: "Attorney Fee", numeric: true },
  pm_fee: { label: "PM Fee", numeric: true },
  dpts_override: { label: "Down Payment to Seller", numeric: true },
  wholesaler_name: { label: "Wholesaler Name", numeric: false },
  // EMD intelligence (migration 20260802010000)
  emd_amount: { label: "EMD Amount", numeric: true },
  emd_hard_date: { label: "EMD Hard Date", numeric: false, date: true },
  emd_extension_count: { label: "EMD Extensions", numeric: true },
  emd_notes: { label: "EMD Notes", numeric: false },
  // Written programmatically by approveDealUpdate (Deal Intelligence Engine,
  // migration 20260802220000) — not exposed as a manual EditableRow anywhere.
  appraisal_received_at: { label: "Appraisal Received", numeric: false },
};
