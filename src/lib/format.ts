/** Display formatters shared across server and client components. */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$700,000" — or "—" for null/undefined. */
export function money(value: number | null | undefined): string {
  return value == null ? "—" : USD.format(value);
}

/** Compact money for tight card metrics: "$2.2M", "$700K". */
export function moneyCompact(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return USD.format(value);
}

/**
 * "9.125%" — for values already expressed as a percent number (e.g. an
 * interest rate of 9.125). Trims trailing zeros, null-safe.
 */
export function percent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${parseFloat(value.toFixed(3))}%`;
}

/**
 * "52.98%" — for values stored as a ratio (e.g. LTV of 0.5298). Multiplies by
 * 100 before formatting.
 */
export function percentFromRatio(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${parseFloat((value * 100).toFixed(2))}%`;
}

/** "Updated today" / "Updated 3d ago". */
export function updatedLabel(days: number): string {
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated 1d ago";
  return `Updated ${days}d ago`;
}
