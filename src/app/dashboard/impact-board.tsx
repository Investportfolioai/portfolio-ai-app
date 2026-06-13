import { createAdminClient } from "@/lib/supabase/admin";

function money(n: number | null): string {
  if (n == null || n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

interface ClosedRow {
  cashback_at_close: number | null;
  assignment_fee: number | null;
  portfolio_ai_fee: number | null;
  credit_partner_fee: number | null;
  tl_fee: number | null;
  submitter_email: string | null;
  property_address: string | null;
  closed_at: string | null;
}

export async function ImpactBoard() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deals")
    .select(
      "cashback_at_close, assignment_fee, portfolio_ai_fee, credit_partner_fee, tl_fee, submitter_email, property_address, closed_at",
    )
    .eq("status", "closed");

  if (error) {
    console.error("[ImpactBoard] fetch failed:", error.message);
    return null;
  }

  const rows = (data ?? []) as ClosedRow[];

  const sum = (key: keyof ClosedRow) =>
    rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

  const totalCashback = sum("cashback_at_close");
  const totalAssignment = sum("assignment_fee");
  const totalPaiFees = sum("portfolio_ai_fee");
  const totalKpFees = sum("credit_partner_fee");
  const totalTlFees = sum("tl_fee");

  // Top wholesalers by deal count.
  const wholesalerCounts = new Map<string, number>();
  for (const r of rows) {
    const email = r.submitter_email?.trim().toLowerCase();
    if (email) wholesalerCounts.set(email, (wholesalerCounts.get(email) ?? 0) + 1);
  }
  const topWholesalers = [...wholesalerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Top addresses by year.
  const byYear = new Map<number, string[]>();
  for (const r of rows) {
    if (!r.closed_at || !r.property_address) continue;
    const yr = new Date(r.closed_at).getFullYear();
    const list = byYear.get(yr) ?? [];
    list.push(r.property_address);
    byYear.set(yr, list);
  }
  const sortedYears = [...byYear.keys()].sort((a, b) => b - a);

  const totals = [
    { label: "Deals Closed", value: String(rows.length) },
    { label: "Total Cashback", value: money(totalCashback) },
    { label: "Assignment Fees", value: money(totalAssignment) },
    { label: "Portfolio AI Fees", value: money(totalPaiFees) },
    { label: "KP Fees Paid", value: money(totalKpFees) },
    { label: "TL Fees Paid", value: money(totalTlFees) },
  ];

  return (
    <section className="mt-8">
      <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Impact Board
      </div>

      <div className="overflow-hidden rounded-2xl bg-[#0f1c3f]">
        {/* Lifetime totals */}
        <div className="border-b border-white/10 px-6 py-4">
          <div className="mb-4 text-xs font-medium uppercase tracking-widest text-white/40">
            Lifetime Totals
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {totals.map((t) => (
              <div key={t.label}>
                <div className="font-mono text-2xl font-medium text-[#d4af37]">{t.value}</div>
                <div className="mt-0.5 text-[11px] text-white/40">{t.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Leaderboards */}
        <div className="grid grid-cols-1 gap-0 divide-y divide-white/10 md:grid-cols-2 md:divide-x md:divide-y-0">
          {/* Top Wholesalers */}
          <div className="px-6 py-5">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-white/40">
              Top Wholesalers
            </div>
            {topWholesalers.length === 0 ? (
              <p className="text-xs text-white/30">No data yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {topWholesalers.map(([email, count], i) => (
                  <li key={email} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0 text-xs font-medium text-white/20">#{i + 1}</span>
                      <span className="truncate text-sm text-white/80">{email}</span>
                    </div>
                    <span className="shrink-0 font-mono text-sm text-[#d4af37]">
                      {count} {count === 1 ? "deal" : "deals"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Deals by Year */}
          <div className="px-6 py-5">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-white/40">
              Closed by Year
            </div>
            {sortedYears.length === 0 ? (
              <p className="text-xs text-white/30">No closed deals yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {sortedYears.slice(0, 5).map((yr) => {
                  const addrs = byYear.get(yr) ?? [];
                  return (
                    <li key={yr} className="flex items-center justify-between gap-4">
                      <span className="text-sm text-white/80">{yr}</span>
                      <div className="text-right">
                        <span className="font-mono text-sm text-[#d4af37]">
                          {addrs.length} {addrs.length === 1 ? "deal" : "deals"}
                        </span>
                        {addrs.length <= 3 && (
                          <div className="mt-0.5 text-[10px] text-white/30">
                            {addrs.map((a) => a.split(",")[0]).join(" · ")}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
