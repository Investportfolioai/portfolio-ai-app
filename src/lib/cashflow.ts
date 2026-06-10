import "server-only";

const FIELDS = [
  "income_rent",
  "income_other",
  "outflow_mortgage",
  "outflow_seller_carry",
  "outflow_taxes",
  "outflow_hoa",
  "outflow_other",
] as const;

export type FinancialFields = Partial<Record<(typeof FIELDS)[number], number | null>>;

export function netCashflow(f: FinancialFields | Record<string, unknown> | null | undefined): number {
  if (!f) return 0;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return (
    n((f as Record<string, unknown>).income_rent) +
    n((f as Record<string, unknown>).income_other) -
    n((f as Record<string, unknown>).outflow_mortgage) -
    n((f as Record<string, unknown>).outflow_seller_carry) -
    n((f as Record<string, unknown>).outflow_taxes) -
    n((f as Record<string, unknown>).outflow_hoa) -
    n((f as Record<string, unknown>).outflow_other)
  );
}
