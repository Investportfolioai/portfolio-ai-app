"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useCountUp } from "@/hooks/useCountUp";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { money } from "@/lib/format";
import { daysSince, portfolioAiFee } from "@/lib/types";
import { getBalloonStatus, formatBalloonDisplay } from "@/lib/balloon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChartPoint {
  date: string;   // ISO date e.g. "2024-06-01"
  value: number;  // sum of avm_value across all holdings that day
}

export interface PortfolioDeal {
  id: string;
  property_address: string;
  purchase_price: number | null;
  arv: number | null;
  acquisition_grade: number | null;
  stabilization_grade: number | null;
  created_at: string;
  status: string;
  cashback_at_close: number | null;
  escrow_date: string | null;
}

interface Financials {
  income_rent?: number | null;
  income_other?: number | null;
  outflow_mortgage?: number | null;
  outflow_seller_carry?: number | null;
  outflow_taxes?: number | null;
  outflow_hoa?: number | null;
  outflow_other?: number | null;
}
interface DocRow {
  id: string;
  file_name: string | null;
  doc_type: string | null;
  created_at: string;
  parsed_data: unknown | null;
  signed_url: string | null;
}
interface Snapshot {
  id: string;
  avm_value: number | null;
  snapshot_date: string;
}
interface Holding {
  id: string;
  address: string;
  property_type: string | null;
  purchase_price: number | null;
  acquisition_date: string | null;
  mortgage_balance: number | null;
  monthly_payment: number | null;
  zillow_avm: number | null;
  zillow_last_pulled: string | null;
  notes: string | null;
  created_at: string;
  balloon_date: string | null;
  balloon_notes: string | null;
  extension_clause: string | null;
  seller_carry_balance: number | null;
  seller_carry_payment: number | null;
  seller_carry_maturity: string | null;
  purchase_close_price: number | null;
  important_notes: string | null;
  lease_end_date: string | null;
  tenant_name: string | null;
  financials: Financials | null;
  net_cashflow: number;
  documents: DocRow[];
  snapshots: Snapshot[];
}

type Tab = "holdings" | "pending" | "escrow" | "balloon";

const DOC_TYPES = [
  ["closing", "Closing Docs"],
  ["mortgage", "Mortgage"],
  ["seller_note", "Seller Note"],
  ["lease", "Lease"],
  ["other", "Other"],
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function eqColor(n: number | null): string {
  if (n == null) return "text-white/60";
  return n >= 0 ? "text-emerald-400" : "text-rose-400";
}
function netOf(f: Financials | null | undefined): number {
  if (!f) return 0;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return (
    n(f.income_rent) + n(f.income_other) - n(f.outflow_mortgage) -
    n(f.outflow_seller_carry) - n(f.outflow_taxes) - n(f.outflow_hoa) - n(f.outflow_other)
  );
}
function appreciationPct(h: Holding): number | null {
  if (h.zillow_avm == null || !h.purchase_close_price) return null;
  return ((h.zillow_avm - h.purchase_close_price) / h.purchase_close_price) * 100;
}
function letterGrade(n: number | null): { letter: string; cls: string } {
  if (n == null) return { letter: "—", cls: "bg-white/10 text-white/50 ring-white/15" };
  if (n >= 90) return { letter: "A", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" };
  if (n >= 80) return { letter: "B", cls: "bg-[#c9a84c]/15 text-[#e6ce86] ring-[#c9a84c]/40" };
  if (n >= 70) return { letter: "C", cls: "bg-orange-500/15 text-orange-300 ring-orange-400/30" };
  return { letter: n >= 60 ? "D" : "F", cls: "bg-rose-500/15 text-rose-300 ring-rose-400/30" };
}
function updatedLabel(iso: string | null): string {
  if (!iso) return "Not pulled yet";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "Updated just now";
  if (h < 24) return `Updated ${h}h ago`;
  return `Updated ${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function PortfolioClient({
  pending,
  escrow,
  chartData,
}: {
  pending: PortfolioDeal[];
  escrow: PortfolioDeal[];
  chartData: ChartPoint[];
}) {
  const [tab, setTab] = useState<Tab>("holdings");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<{ equity: number; fits: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/holdings");
      const json = await res.json();
      setHoldings(res.ok ? json.holdings ?? [] : []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function celebrateAdd(equity: number, fits: boolean) {
    setCelebrate({ equity, fits });
    setTimeout(() => setCelebrate(null), 5000);
  }

  const openHolding = holdings.find((h) => h.id === openId) ?? null;

  const TABS: [Tab, string][] = [
    ["holdings", "Current Holdings"],
    ["pending", "Pending Pipeline"],
    ["escrow", "Escrow Pipeline"],
    ["balloon", "Balloon Tracker"],
  ];

  return (
    <div className="fade-up min-h-screen px-8 py-8 text-white" style={{ background: "#0A0B14" }}>
      {celebrate && (
        <div className="fixed inset-x-0 top-0 z-[60] bg-[#c9a84c] px-6 py-3 text-center text-sm font-semibold text-[#0a1628] shadow-lg">
          🎉 Property added to your portfolio — {money(celebrate.equity)} equity position established.
          {celebrate.fits ? " Fits your buybox." : ""}
        </div>
      )}

      <header className="mx-auto max-w-6xl">
        <h1 className="text-3xl tracking-tight text-white">Portfolio</h1>
        <p className="mt-2 text-[15px] font-light text-white/50">
          Holdings, pipeline, balloons, and portfolio intelligence.
        </p>

        <StatsBar holdings={holdings} />

        <IntelDashboard holdings={holdings} pending={pending} escrow={escrow} chartData={chartData} />

        <nav className="mt-8 flex flex-wrap gap-1 border-b border-white/10">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-[#c9a84c] text-[#c9a84c]"
                  : "border-transparent text-white/50 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto mt-6 max-w-6xl">
        {tab === "holdings" && (
          <HoldingsTab
            holdings={holdings}
            loading={loading}
            onReload={load}
            onOpen={setOpenId}
            onCelebrate={celebrateAdd}
          />
        )}
        {tab === "pending" && <PendingTab deals={pending} />}
        {tab === "escrow" && <EscrowTab deals={escrow} />}
        {tab === "balloon" && <BalloonTrackerTab holdings={holdings} onOpen={setOpenId} />}
      </div>

      {openHolding && (
        <HoldingDrawer holding={openHolding} onClose={() => setOpenId(null)} onReload={load} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header stats bar (STEP 9)
// ---------------------------------------------------------------------------

function StatsBar({ holdings }: { holdings: Holding[] }) {
  const stats = useMemo(() => {
    let value = 0,
      equity = 0,
      net = 0,
      avmSum = 0,
      closeSum = 0;
    for (const h of holdings) {
      if (h.zillow_avm != null) value += h.zillow_avm;
      if (h.zillow_avm != null && h.mortgage_balance != null) equity += h.zillow_avm - h.mortgage_balance;
      net += h.net_cashflow ?? netOf(h.financials);
      if (h.zillow_avm != null && h.purchase_close_price) {
        avmSum += h.zillow_avm;
        closeSum += h.purchase_close_price;
      }
    }
    const appr = closeSum > 0 ? ((avmSum - closeSum) / closeSum) * 100 : null;
    return { count: holdings.length, value, equity, net, appr };
  }, [holdings]);

  const cCount = useCountUp(stats.count, 800);
  const cValue = useCountUp(stats.value, 1400);
  const cEquity = useCountUp(stats.equity, 1400);
  const cNet = useCountUp(stats.net, 1200);
  const cAppr = useCountUp(stats.appr ?? 0, 1000);

  const apprDisplay =
    stats.appr == null
      ? "—"
      : `${cAppr >= 0 ? "▲ +" : "▼ "}${Math.abs(cAppr).toFixed(1)}%`;

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
      <StatCard label="Total Properties" value={String(Math.round(cCount))} />
      <StatCard label="Portfolio Value" value={fmtCompact(cValue)} gold big />
      <StatCard label="Total Equity" value={fmtCompact(cEquity)} cls={eqColor(stats.equity)} />
      <StatCard
        label="Monthly Net Cashflow"
        value={fmtCompact(cNet)}
        cls={stats.net >= 0 ? "text-emerald-400" : "text-rose-400"}
      />
      <StatCard
        label="Appreciation"
        value={apprDisplay}
        cls={stats.appr == null ? "text-white/60" : stats.appr >= 0 ? "text-emerald-400" : "text-rose-400"}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  cls = "text-white",
  gold,
  big,
}: {
  label: string;
  value: string;
  cls?: string;
  gold?: boolean;
  big?: boolean;
}) {
  return (
    <div className="glass-card px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p
        className={`data-number mt-1 tabular-nums ${big ? "text-xl" : "text-lg"} font-medium ${
          gold ? "text-[#c9a84c]" : cls
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio Intelligence Dashboard
// ---------------------------------------------------------------------------

type IntelTab = "overview" | "returns" | "balloon" | "pipeline";

function IntelDashboard({
  holdings,
  pending,
  escrow,
  chartData: rawChartData,
}: {
  holdings: Holding[];
  pending: PortfolioDeal[];
  escrow: PortfolioDeal[];
  chartData: ChartPoint[];
}) {
  const [intelTab, setIntelTab] = useState<IntelTab>("overview");

  // Format the server-fetched chart data for recharts
  const chartData = useMemo(
    () =>
      rawChartData.map((p) => ({
        date: new Date(p.date).toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        value: p.value,
      })),
    [rawChartData],
  );

  const INTEL_TABS: [IntelTab, string][] = [
    ["overview", "Overview"],
    ["returns", "Returns"],
    ["balloon", "Balloon Risk"],
    ["pipeline", "Pipeline"],
  ];

  return (
    <div className="mt-8">
      {/* Chart */}
      <div className="glass-card p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          Portfolio Value Over Time
        </p>
        {chartData.length === 0 ? (
          <div className="flex h-44 items-center justify-center">
            <p className="text-sm text-white/30">Tracking begins once holdings are added.</p>
          </div>
        ) : (
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="rgba(255,255,255,0.25)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.25)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={76}
                  tickFormatter={(v) => money(Number(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0d1b30",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 12,
                  }}
                  formatter={(v) => [money(Number(v)), "Portfolio Value"]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#c9a84c"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ fill: "#c9a84c", r: 4, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Intel tab row */}
      <div className="mt-5 flex gap-0.5 border-b border-white/10">
        {INTEL_TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setIntelTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-medium transition-colors ${
              intelTab === key
                ? "border-[#c9a84c] text-[#c9a84c]"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Metrics panel */}
      <div className="mt-4">
        {intelTab === "overview" && <IntelOverview holdings={holdings} />}
        {intelTab === "returns" && <IntelReturns holdings={holdings} />}
        {intelTab === "balloon" && <IntelBalloon holdings={holdings} />}
        {intelTab === "pipeline" && <IntelPipeline pending={pending} escrow={escrow} />}
      </div>
    </div>
  );
}

function IntelMetricCard({
  label,
  value,
  cls = "text-white",
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className={`data-number mt-2 text-xl font-medium tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function IntelOverview({ holdings }: { holdings: Holding[] }) {
  const stats = useMemo(() => {
    let value = 0, equity = 0, cashflow = 0, avmSum = 0, closeSum = 0;
    for (const h of holdings) {
      if (h.zillow_avm != null) value += h.zillow_avm;
      if (h.zillow_avm != null && h.mortgage_balance != null)
        equity += h.zillow_avm - h.mortgage_balance;
      cashflow += h.net_cashflow ?? netOf(h.financials);
      if (h.zillow_avm != null && h.purchase_close_price) {
        avmSum += h.zillow_avm;
        closeSum += h.purchase_close_price;
      }
    }
    const appr = closeSum > 0 ? ((avmSum - closeSum) / closeSum) * 100 : null;
    return { value, equity, cashflow, appr };
  }, [holdings]);

  const cValue = useCountUp(stats.value, 1400);
  const cEquity = useCountUp(stats.equity, 1400);
  const cCashflow = useCountUp(stats.cashflow, 1200);
  const cAppr = useCountUp(stats.appr ?? 0, 1000);

  const apprDisplay =
    stats.appr == null
      ? "—"
      : `${cAppr >= 0 ? "+" : ""}${cAppr.toFixed(1)}%`;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <IntelMetricCard label="Total Portfolio Value" value={fmtCompact(cValue)} cls="text-[#c9a84c]" />
      <IntelMetricCard label="Total Equity" value={fmtCompact(cEquity)} cls={eqColor(stats.equity)} />
      <IntelMetricCard
        label="Monthly Net Cashflow"
        value={fmtCompact(cCashflow)}
        cls={stats.cashflow >= 0 ? "text-emerald-400" : "text-rose-400"}
      />
      <IntelMetricCard
        label="Portfolio Appreciation"
        value={apprDisplay}
        cls={
          stats.appr == null
            ? "text-white/60"
            : stats.appr >= 0
            ? "text-emerald-400"
            : "text-rose-400"
        }
      />
    </div>
  );
}

type ReturnsSortKey =
  | "address"
  | "purchase_close_price"
  | "zillow_avm"
  | "equity"
  | "appreciation_pct"
  | "days_held"
  | "net_cashflow";

function SortTh({
  label,
  col,
  activeCol,
  dir,
  onSort,
}: {
  label: string;
  col: ReturnsSortKey;
  activeCol: ReturnsSortKey;
  dir: "asc" | "desc";
  onSort: (c: ReturnsSortKey) => void;
}) {
  const active = activeCol === col;
  return (
    <th
      className="cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left font-medium transition-colors hover:text-white/70"
      onClick={() => onSort(col)}
    >
      <span className={active ? "text-[#c9a84c]" : ""}>
        {label}
        {active && <span className="ml-1 opacity-60">{dir === "asc" ? "↑" : "↓"}</span>}
      </span>
    </th>
  );
}

function IntelReturns({ holdings }: { holdings: Holding[] }) {
  const [sortCol, setSortCol] = useState<ReturnsSortKey>("equity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(col: ReturnsSortKey) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  const rows = useMemo(() => {
    return [...holdings]
      .map((h) => {
        const equity =
          h.zillow_avm != null && h.mortgage_balance != null
            ? h.zillow_avm - h.mortgage_balance
            : null;
        const appr = appreciationPct(h);
        const net = h.net_cashflow ?? netOf(h.financials);
        const days = h.acquisition_date ? daysSince(h.acquisition_date) : null;
        return { h, equity, appr, net, days };
      })
      .sort((a, b) => {
        if (sortCol === "address") {
          const r = a.h.address.localeCompare(b.h.address);
          return sortDir === "asc" ? r : -r;
        }
        let av: number | null = null, bv: number | null = null;
        if (sortCol === "purchase_close_price") { av = a.h.purchase_close_price; bv = b.h.purchase_close_price; }
        else if (sortCol === "zillow_avm") { av = a.h.zillow_avm; bv = b.h.zillow_avm; }
        else if (sortCol === "equity") { av = a.equity; bv = b.equity; }
        else if (sortCol === "appreciation_pct") { av = a.appr; bv = b.appr; }
        else if (sortCol === "days_held") { av = a.days; bv = b.days; }
        else if (sortCol === "net_cashflow") { av = a.net; bv = b.net; }
        const diff = (av ?? -Infinity) - (bv ?? -Infinity);
        return sortDir === "asc" ? diff : -diff;
      });
  }, [holdings, sortCol, sortDir]);

  if (holdings.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/15 py-10 text-center">
        <p className="text-sm text-white/40">No holdings yet.</p>
      </div>
    );

  const thProps = { activeCol: sortCol, dir: sortDir, onSort: handleSort };

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-[13px]">
        <thead className="border-b border-white/10 bg-white/5 text-[10px] uppercase tracking-widest text-white/40">
          <tr>
            <SortTh label="Address" col="address" {...thProps} />
            <SortTh label="Close Price" col="purchase_close_price" {...thProps} />
            <SortTh label="Current AVM" col="zillow_avm" {...thProps} />
            <SortTh label="Equity" col="equity" {...thProps} />
            <SortTh label="Appreciation" col="appreciation_pct" {...thProps} />
            <SortTh label="Days Held" col="days_held" {...thProps} />
            <SortTh label="Net / mo" col="net_cashflow" {...thProps} />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(({ h, equity, appr, net, days }) => (
            <tr key={h.id} className="hover:bg-white/5">
              <td className="px-4 py-3 text-white">{h.address}</td>
              <td className="data-number px-4 py-3 tabular-nums text-white/60">
                {h.purchase_close_price ? money(h.purchase_close_price) : "—"}
              </td>
              <td className="data-number px-4 py-3 tabular-nums text-white/60">
                {h.zillow_avm ? money(h.zillow_avm) : "—"}
              </td>
              <td className={`data-number px-4 py-3 tabular-nums ${eqColor(equity)}`}>
                {equity != null ? money(equity) : "—"}
              </td>
              <td
                className={`data-number px-4 py-3 tabular-nums ${
                  appr == null ? "text-white/40" : appr >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {appr == null ? "—" : `${appr >= 0 ? "+" : ""}${appr.toFixed(1)}%`}
              </td>
              <td className="data-number px-4 py-3 tabular-nums text-white/60">
                {days != null ? `${days}d` : "—"}
              </td>
              <td
                className={`data-number px-4 py-3 tabular-nums ${net >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {money(net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntelBalloon({ holdings }: { holdings: Holding[] }) {
  const now = Date.now();
  const withBalloon = holdings.filter((h) => h.balloon_date);
  const without = holdings.filter((h) => !h.balloon_date);

  if (holdings.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/15 py-10 text-center">
        <p className="text-sm text-white/40">No holdings yet.</p>
      </div>
    );

  return (
    <div className="space-y-2">
      {withBalloon.map((h) => {
        const balloonMs = new Date(h.balloon_date!).getTime();
        const daysRemaining = Math.ceil((balloonMs - now) / 86_400_000);
        const acqMs = h.acquisition_date ? new Date(h.acquisition_date).getTime() : null;
        const totalDays = acqMs ? Math.max(1, Math.ceil((balloonMs - acqMs) / 86_400_000)) : null;
        const elapsed = acqMs ? Math.ceil((now - acqMs) / 86_400_000) : null;
        const pct =
          totalDays && elapsed != null
            ? Math.min(100, Math.max(0, (elapsed / totalDays) * 100))
            : null;

        const color =
          daysRemaining > 730 ? "#34d399" : daysRemaining > 365 ? "#fbbf24" : "#f87171";
        const barCls =
          daysRemaining > 730
            ? "bg-emerald-400"
            : daysRemaining > 365
            ? "bg-yellow-400"
            : "bg-rose-400";

        return (
          <div key={h.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-white">{h.address}</p>
              <span
                className="shrink-0 text-[11px] font-semibold tabular-nums"
                style={{ color }}
              >
                {daysRemaining > 0 ? `${daysRemaining}d remaining` : "Past due"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-white/40">
              Balloon:{" "}
              {new Date(h.balloon_date!).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
            {pct != null && (
              <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        );
      })}

      {without.map((h) => (
        <div
          key={h.id}
          className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
        >
          <p className="text-sm text-white/50">{h.address}</p>
          <span className="text-[11px] text-white/25">No balloon set</span>
        </div>
      ))}
    </div>
  );
}

function IntelPipeline({
  pending,
  escrow,
}: {
  pending: PortfolioDeal[];
  escrow: PortfolioDeal[];
}) {
  function PipelineRow({ deal, mode }: { deal: PortfolioDeal; mode: "pending" | "escrow" }) {
    const days = mode === "escrow" && deal.escrow_date
      ? daysSince(deal.escrow_date)
      : daysSince(deal.created_at);
    const g = letterGrade(deal.acquisition_grade);
    return (
      <div className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{deal.property_address}</p>
          <p className="mt-0.5 text-[11px] text-white/40">{days}d in pipeline</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${g.cls}`}
          >
            ACQ {g.letter}
          </span>
          <span className="data-number w-24 text-right text-sm tabular-nums text-white/60">
            {deal.purchase_price ? money(deal.purchase_price) : "—"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-white/10">
        <p className="border-b border-white/10 bg-white/5 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          Pending{" "}
          <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px]">
            {pending.length}
          </span>
        </p>
        {pending.length === 0 ? (
          <p className="px-4 py-4 text-sm text-white/30">No pending deals.</p>
        ) : (
          pending.map((d) => <PipelineRow key={d.id} deal={d} mode="pending" />)
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <p className="border-b border-white/10 bg-white/5 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          In Escrow{" "}
          <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px]">
            {escrow.length}
          </span>
        </p>
        {escrow.length === 0 ? (
          <p className="px-4 py-4 text-sm text-white/30">No deals in escrow.</p>
        ) : (
          escrow.map((d) => <PipelineRow key={d.id} deal={d} mode="escrow" />)
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holdings tab + cards (STEP 10)
// ---------------------------------------------------------------------------

function HoldingsTab({
  holdings,
  loading,
  onReload,
  onOpen,
  onCelebrate,
}: {
  holdings: Holding[];
  loading: boolean;
  onReload: () => void;
  onOpen: (id: string) => void;
  onCelebrate: (equity: number, fits: boolean) => void;
}) {
  const [modal, setModal] = useState(false);

  async function remove(id: string) {
    await fetch(`/api/holdings?id=${id}`, { method: "DELETE" });
    onReload();
  }
  async function refreshOne(id: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/holdings?id=${id}&action=refresh`, { method: "PATCH" });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) {
      onReload();
      return { ok: true };
    }
    return { ok: false, error: j.error || "Refresh failed." };
  }

  function exportCsv() {
    const head = ["Address", "Type", "Purchase Price", "Zillow AVM", "Mortgage Balance", "Equity", "Monthly Payment", "Acquisition Date"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = holdings.map((h) => {
      const equity = h.zillow_avm != null && h.mortgage_balance != null ? h.zillow_avm - h.mortgage_balance : "";
      return [h.address, h.property_type ?? "", h.purchase_price ?? "", h.zillow_avm ?? "", h.mortgage_balance ?? "", equity, h.monthly_payment ?? "", h.acquisition_date ?? ""].map(esc).join(",");
    });
    const url = URL.createObjectURL(new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "sreo.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <button
          onClick={exportCsv}
          disabled={holdings.length === 0}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/5 disabled:opacity-40"
        >
          SREO Export (CSV)
        </button>
        <button onClick={() => setModal(true)} className="rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a1628] hover:opacity-90">
          + Add New Holding
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-white/50">Loading holdings…</p>
      ) : holdings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 py-16 text-center">
          <p className="text-sm text-white/70">No holdings yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {holdings.map((h) => (
            <HoldingCard
              key={h.id}
              h={h}
              onDelete={() => remove(h.id)}
              onRefresh={() => refreshOne(h.id)}
              onOpen={() => onOpen(h.id)}
            />
          ))}
        </div>
      )}

      {modal && <AddHoldingModal onClose={() => setModal(false)} onSaved={onReload} onCelebrate={onCelebrate} />}
    </div>
  );
}

function HoldingCard({
  h,
  onDelete,
  onRefresh,
  onOpen,
}: {
  h: Holding;
  onDelete: () => void;
  onRefresh: () => Promise<{ ok: boolean; error?: string }>;
  onOpen: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const equity = h.zillow_avm != null && h.mortgage_balance != null ? h.zillow_avm - h.mortgage_balance : null;
  const bal = getBalloonStatus(h.balloon_date);
  const appr = appreciationPct(h);
  const net = h.net_cashflow ?? netOf(h.financials);

  async function refresh(e: React.MouseEvent) {
    e.stopPropagation();
    setErr("");
    setRefreshing(true);
    try {
      const r = await onRefresh();
      if (!r.ok) setErr(r.error || "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer flex-col rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-[#c9a84c]/40"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-lg leading-snug text-white">{h.address}</h3>
        {h.property_type && (
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white/70">
            {h.property_type}
          </span>
        )}
      </div>

      {/* Balloon badge */}
      <div className="mt-2">
        <span
          className="inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset"
          style={{ color: bal.color, borderColor: bal.color, backgroundColor: `${bal.color}22` }}
        >
          {bal.urgency === "critical" ? `URGENT — ${formatBalloonDisplay(h.balloon_date)}` : h.balloon_date ? `${bal.label} · ${formatBalloonDisplay(h.balloon_date)}` : bal.label}
        </span>
      </div>

      <div className="mt-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="data-number text-2xl font-medium text-[#c9a84c]">{h.zillow_avm != null ? money(h.zillow_avm) : "—"}</p>
          <p className="mt-0.5 text-[11px] text-white/40">Zillow AVM · {refreshing ? "Refreshing…" : updatedLabel(h.zillow_last_pulled)}</p>
        </div>
        <button onClick={refresh} disabled={refreshing} title="Refresh Zillow AVM (~30s)" className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/5 disabled:opacity-50">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {err && <p className="mt-1 text-[11px] text-rose-400">{err}</p>}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4 text-sm">
        <Stat label="Equity" value={equity != null ? money(equity) : "—"} valueCls={eqColor(equity)} />
        <Stat label="Net / mo" value={money(net)} valueCls={net >= 0 ? "text-emerald-400" : "text-rose-400"} />
        <Stat label="Appreciation" value={appr == null ? "—" : `${appr >= 0 ? "+" : ""}${appr.toFixed(1)}%`} valueCls={appr == null ? "text-white/60" : appr >= 0 ? "text-emerald-400" : "text-rose-400"} />
        <Stat label="Days Held" value={h.acquisition_date ? `${daysSince(h.acquisition_date)}d` : "—"} />
      </dl>

      {h.tenant_name && <p className="mt-3 text-xs text-white/60">Tenant: {h.tenant_name}</p>}

      <div className="mt-4 flex justify-end">
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-xs text-white/40 transition-colors hover:text-rose-400">
          Delete
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, valueCls = "text-white" }: { label: string; value: string; valueCls?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-white/40">{label}</dt>
      <dd className={`data-number mt-0.5 tabular-nums ${valueCls}`}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Holding modal (STEP 13 celebration)
// ---------------------------------------------------------------------------

function AddHoldingModal({
  onClose,
  onSaved,
  onCelebrate,
}: {
  onClose: () => void;
  onSaved: () => void;
  onCelebrate: (equity: number, fits: boolean) => void;
}) {
  const [form, setForm] = useState({
    address: "",
    property_type: "SFR",
    purchase_price: "",
    purchase_close_price: "",
    acquisition_date: "",
    mortgage_balance: "",
    monthly_payment: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    setError("");
    start(async () => {
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "Could not save the holding.");
        return;
      }
      onSaved();
      onClose();
      onCelebrate(Number(j.equity_added ?? 0), !!j.fits_buybox);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0a1628] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl text-white">Add Holding</h2>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Address *" value={form.address} onChange={set("address")} className="sm:col-span-2" />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">Property Type</span>
            <select value={form.property_type} onChange={(e) => set("property_type")(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#c9a84c]">
              {["SFR", "Multifamily", "Commercial", "Land"].map((t) => (
                <option key={t} value={t} className="bg-[#0a1628]">{t}</option>
              ))}
            </select>
          </label>
          <Field label="Purchase Price" value={form.purchase_price} onChange={set("purchase_price")} type="number" />
          <Field label="Purchase Close Price" value={form.purchase_close_price} onChange={set("purchase_close_price")} type="number" />
          <Field label="Acquisition Date" value={form.acquisition_date} onChange={set("acquisition_date")} type="date" />
          <Field label="Mortgage Balance" value={form.mortgage_balance} onChange={set("mortgage_balance")} type="number" />
          <Field label="Monthly Payment" value={form.monthly_payment} onChange={set("monthly_payment")} type="number" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">Notes</span>
            <textarea rows={2} value={form.notes} onChange={(e) => set("notes")(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#c9a84c]" />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={saving || !form.address.trim()} className="rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a1628] hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save Holding"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", className = "" }: { label: string; value: string; onChange: (v: string) => void; type?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#c9a84c]" />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Balloon Tracker tab (STEP 12)
// ---------------------------------------------------------------------------

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };

function BalloonTrackerTab({ holdings, onOpen }: { holdings: Holding[]; onOpen: (id: string) => void }) {
  const withBalloon = holdings
    .filter((h) => h.balloon_date)
    .sort((a, b) => URGENCY_RANK[getBalloonStatus(a.balloon_date).urgency] - URGENCY_RANK[getBalloonStatus(b.balloon_date).urgency]);
  const without = holdings.filter((h) => !h.balloon_date);
  const critical = withBalloon.filter((h) => getBalloonStatus(h.balloon_date).urgency === "critical").length;
  const action = withBalloon.filter((h) => getBalloonStatus(h.balloon_date).urgency === "high").length;

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatCard label="With Balloons" value={String(withBalloon.length)} />
        <StatCard label="Critical" value={String(critical)} cls={critical > 0 ? "text-rose-400" : "text-white"} />
        <StatCard label="Action Needed" value={String(action)} cls={action > 0 ? "text-orange-400" : "text-white"} />
      </div>

      {withBalloon.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 py-10 text-center text-sm text-white/60">No balloon dates set yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-[10px] uppercase tracking-widest text-white/40">
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Balloon Date</th>
                <th className="px-4 py-3 font-medium">Remaining</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Extension</th>
                <th className="px-4 py-3 text-right font-medium">Monthly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {withBalloon.map((h) => {
                const b = getBalloonStatus(h.balloon_date);
                return (
                  <tr key={h.id} onClick={() => onOpen(h.id)} className="cursor-pointer hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{h.address}</td>
                    <td className="px-4 py-3 text-white/70">{h.balloon_date}</td>
                    <td className="px-4 py-3 text-white/70">{formatBalloonDisplay(h.balloon_date)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset" style={{ color: b.color, borderColor: b.color, backgroundColor: `${b.color}22` }}>
                        {b.label}
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-white/50">{h.extension_clause ?? "—"}</td>
                    <td className="data-number px-4 py-3 text-right tabular-nums text-white/70">{money(h.monthly_payment)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {without.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">No balloon date set</p>
          <div className="space-y-2">
            {without.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
                <span className="text-sm text-white/80">{h.address}</span>
                <button onClick={() => onOpen(h.id)} className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/70 hover:bg-white/5">
                  Set Balloon Date
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holding detail drawer (STEP 11)
// ---------------------------------------------------------------------------

type DrawerTab = "overview" | "financials" | "documents" | "history";

function HoldingDrawer({ holding, onClose, onReload }: { holding: Holding; onClose: () => void; onReload: () => void }) {
  const [tab, setTab] = useState<DrawerTab>("overview");

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const TABS: [DrawerTab, string][] = [
    ["overview", "Overview"],
    ["financials", "Financials"],
    ["documents", "Documents"],
    ["history", "History"],
  ];

  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/50" onClick={onClose}>
      <aside className="flex h-full w-full md:max-w-[600px] flex-col border-l border-white/10 bg-[#0a1628]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl text-white">{holding.address}</h2>
            <p className="text-xs text-white/40">{holding.property_type ?? "—"}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white">✕</button>
        </div>

        <div className="flex border-b border-white/10 px-3">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${tab === k ? "border-[#c9a84c] text-[#c9a84c]" : "border-transparent text-white/50 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "overview" && <OverviewTab holding={holding} onReload={onReload} />}
          {tab === "financials" && <FinancialsTab holding={holding} onReload={onReload} />}
          {tab === "documents" && <DocumentsTab holding={holding} onReload={onReload} />}
          {tab === "history" && <HistoryTab holding={holding} />}
        </div>
      </aside>
    </div>
  );
}

function OverviewTab({ holding, onReload }: { holding: Holding; onReload: () => void }) {
  const bal = getBalloonStatus(holding.balloon_date);
  const save = async (field: string, value: string) => {
    await fetch(`/api/holdings?id=${holding.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    onReload();
  };
  return (
    <div className="space-y-1">
      <EditRow label="Address" value={holding.address} onSave={(v) => save("address", v)} />
      <EditRow label="Property Type" value={holding.property_type} onSave={(v) => save("property_type", v)} />
      <EditRow label="Acquisition Date" value={holding.acquisition_date} type="date" onSave={(v) => save("acquisition_date", v)} />
      <EditRow label="Purchase Close Price" value={holding.purchase_close_price} type="number" money onSave={(v) => save("purchase_close_price", v)} />
      <EditRow label="Mortgage Balance" value={holding.mortgage_balance} type="number" money onSave={(v) => save("mortgage_balance", v)} />
      <EditRow label="Monthly Payment" value={holding.monthly_payment} type="number" money onSave={(v) => save("monthly_payment", v)} />
      <EditRow label="Seller Carry Balance" value={holding.seller_carry_balance} type="number" money onSave={(v) => save("seller_carry_balance", v)} />
      <EditRow label="Seller Carry Payment" value={holding.seller_carry_payment} type="number" money onSave={(v) => save("seller_carry_payment", v)} />
      <EditRow label="Seller Carry Maturity" value={holding.seller_carry_maturity} type="date" onSave={(v) => save("seller_carry_maturity", v)} />
      <EditRow label="Tenant Name" value={holding.tenant_name} onSave={(v) => save("tenant_name", v)} />
      <EditRow label="Lease End Date" value={holding.lease_end_date} type="date" onSave={(v) => save("lease_end_date", v)} />
      <div className="flex items-center justify-between border-b border-white/5 py-2">
        <span className="text-[11px] uppercase tracking-widest text-white/40">Balloon Status</span>
        <span className="text-sm font-medium" style={{ color: bal.color }}>{bal.label} · {formatBalloonDisplay(holding.balloon_date)}</span>
      </div>
      <EditRow label="Balloon Date" value={holding.balloon_date} type="date" onSave={(v) => save("balloon_date", v)} />
      <EditRow label="Balloon Notes" value={holding.balloon_notes} onSave={(v) => save("balloon_notes", v)} />
      <EditRow label="Extension Clause" value={holding.extension_clause} onSave={(v) => save("extension_clause", v)} />
      <EditRow label="Important Notes (AI)" value={holding.important_notes} multiline onSave={(v) => save("important_notes", v)} />
    </div>
  );
}

function EditRow({
  label,
  value,
  type = "text",
  money: isMoney,
  multiline,
  onSave,
}: {
  label: string;
  value: string | number | null;
  type?: string;
  money?: boolean;
  multiline?: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value == null ? "" : String(value));
  useEffect(() => setVal(value == null ? "" : String(value)), [value]);

  const display = value == null || value === "" ? "—" : isMoney ? money(Number(value)) : String(value);

  function commit() {
    setEditing(false);
    if (val !== (value == null ? "" : String(value))) onSave(val);
  }

  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2">
      <span className="shrink-0 pt-0.5 text-[11px] uppercase tracking-widest text-white/40">{label}</span>
      {editing ? (
        multiline ? (
          <textarea autoFocus rows={3} value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit} className="w-1/2 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-right text-sm text-white outline-none focus:border-[#c9a84c]" />
        ) : (
          <input autoFocus type={type} value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit} className="w-1/2 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-right text-sm text-white outline-none focus:border-[#c9a84c]" />
        )
      ) : (
        <button onClick={() => setEditing(true)} className="max-w-[60%] truncate text-right text-sm text-white hover:text-[#c9a84c]" title="Click to edit">
          {display}
        </button>
      )}
    </div>
  );
}

function FinancialsTab({ holding, onReload }: { holding: Holding; onReload: () => void }) {
  const f = holding.financials ?? {};
  const [form, setForm] = useState({
    income_rent: String(f.income_rent ?? ""),
    income_other: String(f.income_other ?? ""),
    outflow_mortgage: String(f.outflow_mortgage ?? ""),
    outflow_seller_carry: String(f.outflow_seller_carry ?? ""),
    outflow_taxes: String(f.outflow_taxes ?? ""),
    outflow_hoa: String(f.outflow_hoa ?? ""),
    outflow_other: String(f.outflow_other ?? ""),
  });
  const [saving, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => { setForm((s) => ({ ...s, [k]: v })); setSaved(false); };
  const n = (v: string) => Number(v || 0) || 0;
  const net = n(form.income_rent) + n(form.income_other) - n(form.outflow_mortgage) - n(form.outflow_seller_carry) - n(form.outflow_taxes) - n(form.outflow_hoa) - n(form.outflow_other);

  function save() {
    start(async () => {
      await fetch("/api/holdings/financials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holding_id: holding.id, ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, n(v)])) }),
      });
      setSaved(true);
      onReload();
    });
  }

  return (
    <div className="space-y-5">
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-300/70">Income</p>
        <MoneyField label="Rent" value={form.income_rent} onChange={set("income_rent")} />
        <MoneyField label="Other Income" value={form.income_other} onChange={set("income_other")} />
      </section>
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-rose-300/70">Outflow</p>
        <MoneyField label="Mortgage" value={form.outflow_mortgage} onChange={set("outflow_mortgage")} />
        <MoneyField label="Seller Carry" value={form.outflow_seller_carry} onChange={set("outflow_seller_carry")} />
        <MoneyField label="Taxes" value={form.outflow_taxes} onChange={set("outflow_taxes")} />
        <MoneyField label="HOA" value={form.outflow_hoa} onChange={set("outflow_hoa")} />
        <MoneyField label="Other" value={form.outflow_other} onChange={set("outflow_other")} />
      </section>
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
        <span className="text-sm text-white/70">Net Cashflow / mo</span>
        <span className={`data-number text-lg font-medium tabular-nums ${net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{money(net)}</span>
      </div>
      <button onClick={save} disabled={saving} className="w-full rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a1628] hover:opacity-90 disabled:opacity-50">
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save Financials"}
      </button>
    </div>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 flex items-center justify-between gap-3">
      <span className="text-sm text-white/60">{label}</span>
      <div className="flex items-center rounded-md border border-white/15 bg-white/5 px-2 py-1">
        <span className="text-white/40">$</span>
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" className="w-28 bg-transparent px-1 text-right text-sm text-white outline-none" />
      </div>
    </label>
  );
}

function DocumentsTab({ holding, onReload }: { holding: Holding; onReload: () => void }) {
  const [docs, setDocs] = useState<DocRow[]>(holding.documents ?? []);
  const [docType, setDocType] = useState<string>("closing");
  const [status, setStatus] = useState<string>("");
  const [updatedFields, setUpdatedFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshDocs = useCallback(async () => {
    const res = await fetch(`/api/holdings/documents?holding_id=${holding.id}`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) setDocs(j.documents ?? []);
  }, [holding.id]);

  async function upload(file: File) {
    setBusy(true);
    setUpdatedFields([]);
    setStatus("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("holding_id", holding.id);
      fd.append("doc_type", docType);
      setStatus("Parsing document…");
      const res = await fetch("/api/holdings/documents", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(j.error || "Upload failed.");
        return;
      }
      setUpdatedFields(j.updated ?? []);
      setStatus(j.updated?.length ? "Fields updated from AI" : "Uploaded (no new fields extracted)");
      await refreshDocs();
      onReload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/holdings/documents?id=${id}`, { method: "DELETE" });
    refreshDocs();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#c9a84c]">
          {DOC_TYPES.map(([v, l]) => (
            <option key={v} value={v} className="bg-[#0a1628]">{l}</option>
          ))}
        </select>
      </div>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 px-4 py-8 text-center hover:border-[#c9a84c]/50"
      >
        <span className="text-sm text-white/70">{busy ? status : "Drop a file or click to upload"}</span>
        <span className="mt-1 text-[11px] text-white/40">PDF or image — parsed by AI on upload</span>
        <input type="file" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      </label>

      {!busy && status && (
        <div className="rounded-lg border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-4 py-3 text-sm text-[#e6ce86]">
          {status}
          {updatedFields.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-white/70">
              {updatedFields.map((f) => (<li key={f}>{f.replace(/_/g, " ")}</li>))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-2">
        {docs.length === 0 ? (
          <p className="text-xs text-white/40">No documents uploaded yet.</p>
        ) : (
          docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{d.file_name ?? "Document"}</p>
                <p className="text-[11px] text-white/40">
                  {(DOC_TYPES.find(([v]) => v === d.doc_type)?.[1]) ?? d.doc_type ?? "Other"} · {new Date(d.created_at).toLocaleDateString("en-US")}
                  {d.parsed_data ? " · " : ""}
                  {!!d.parsed_data && <span className="text-[#c9a84c]">AI Parsed</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {d.signed_url && (
                  <a href={d.signed_url} target="_blank" rel="noopener noreferrer" className="text-xs text-white/40 hover:text-white">Download</a>
                )}
                <button onClick={() => remove(d.id)} className="text-xs text-white/40 hover:text-rose-400">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryTab({ holding }: { holding: Holding }) {
  const data = (holding.snapshots ?? []).map((s) => ({
    date: new Date(s.snapshot_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: s.avm_value ?? 0,
  }));
  const appr = appreciationPct(holding);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40">Appreciation since close</p>
          <p className="text-xs text-white/50">{money(holding.purchase_close_price)} → {money(holding.zillow_avm)}</p>
        </div>
        <span className={`data-number text-lg font-medium ${appr == null ? "text-white/60" : appr >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {appr == null ? "—" : `${appr >= 0 ? "+" : ""}${appr.toFixed(1)}%`}
        </span>
      </div>

      {data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 py-10 text-center text-xs text-white/40">
          No snapshots yet. A weekly snapshot is recorded every Monday.
        </p>
      ) : (
        <div className="h-64 w-full rounded-xl border border-white/10 bg-white/5 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} width={64} tickFormatter={(v) => money(Number(v))} />
              <Tooltip contentStyle={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }} formatter={(v) => money(Number(v))} />
              <Line type="monotone" dataKey="value" stroke="#c9a84c" strokeWidth={2} dot={{ fill: "#c9a84c", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending + Escrow tabs (unchanged)
// ---------------------------------------------------------------------------

function GradeBadge({ label, value }: { label: string; value: number | null }) {
  const g = letterGrade(value);
  return (
    <span title={value != null ? `${label} ${value}/100` : `${label} ungraded`} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${g.cls}`}>
      {label} {g.letter}
      {value != null && <span className="ml-1 opacity-70">{value}</span>}
    </span>
  );
}

function DealCard({ deal, mode }: { deal: PortfolioDeal; mode: "pending" | "escrow" }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [cashback, setCashback] = useState<string>(deal.cashback_at_close != null ? String(deal.cashback_at_close) : "");

  const equitySpread = deal.arv != null && deal.purchase_price != null ? deal.arv - deal.purchase_price : null;
  const cbNum = cashback === "" ? null : Number(cashback);
  const cbPct = cbNum != null && deal.purchase_price ? (cbNum / deal.purchase_price) * 100 : null;
  const aiFee = portfolioAiFee({ cashback_at_close: cbNum, purchase_price: deal.purchase_price });

  function saveCashback() {
    start(async () => {
      await fetch("/api/deals/escrow", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_id: deal.id, cashback_at_close: cashback === "" ? null : cbNum }) });
      router.refresh();
    });
  }
  function moveToEscrow() {
    start(async () => {
      await fetch("/api/deals/escrow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_id: deal.id }) });
      router.refresh();
    });
  }

  const days = mode === "escrow" && deal.escrow_date ? daysSince(deal.escrow_date) : daysSince(deal.created_at);

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-lg leading-snug text-white">{deal.property_address}</h3>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <GradeBadge label="ACQ" value={deal.acquisition_grade} />
          <GradeBadge label="STAB" value={deal.stabilization_grade} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4 text-sm">
        <Stat label="Purchase Price" value={money(deal.purchase_price)} />
        <Stat label="ARV" value={money(deal.arv)} />
        <Stat label="Equity Spread" value={money(equitySpread)} valueCls={eqColor(equitySpread)} />
        <Stat label={mode === "escrow" ? "Days in Escrow" : "Days in Pending"} value={`${days}d`} />
      </dl>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-sm">
        <span className="text-[10px] uppercase tracking-widest text-white/40">Portfolio AI Fee (10% of cashback)</span>
        <span className="data-number tabular-nums text-[#c9a84c]">{aiFee != null ? money(aiFee) : "—"}</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-[10px] uppercase tracking-widest text-white/40">Cashback at Close</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-white/15 bg-white/5 px-2 py-1">
            <span className="text-white/40">$</span>
            <input type="number" value={cashback} onChange={(e) => setCashback(e.target.value)} onBlur={saveCashback} placeholder="0" className="w-24 bg-transparent px-1 text-right text-sm text-white outline-none" />
          </div>
          {cbPct != null && <span className="rounded-full bg-[#c9a84c]/15 px-2 py-1 text-[10px] font-semibold text-[#e6ce86] ring-1 ring-inset ring-[#c9a84c]/40">{cbPct.toFixed(1)}%</span>}
        </div>
      </div>
      {mode === "escrow" && deal.escrow_date && <p className="mt-3 text-[11px] text-white/40">In escrow since {new Date(deal.escrow_date).toLocaleDateString("en-US")}</p>}
      {mode === "pending" && (
        <button onClick={moveToEscrow} disabled={busy} className="mt-4 rounded-lg bg-[#c9a84c] px-4 py-2 text-xs font-semibold text-[#0a1628] hover:opacity-90 disabled:opacity-50">
          {busy ? "Moving…" : "Move to Escrow"}
        </button>
      )}
    </div>
  );
}

function PendingTab({ deals }: { deals: PortfolioDeal[] }) {
  if (deals.length === 0) return <div className="rounded-xl border border-dashed border-white/15 py-16 text-center"><p className="text-sm text-white/70">No pending deals</p></div>;
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{deals.map((d) => <DealCard key={d.id} deal={d} mode="pending" />)}</div>;
}

function EscrowTab({ deals }: { deals: PortfolioDeal[] }) {
  const withCashback = deals.filter((d) => d.cashback_at_close != null && d.purchase_price);
  const avgPct = withCashback.length > 0 ? withCashback.reduce((s, d) => s + (d.cashback_at_close! / d.purchase_price!) * 100, 0) / withCashback.length : null;
  const cls = avgPct == null ? "border-white/15 text-white/60" : avgPct >= 3 ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : avgPct >= 1 ? "border-yellow-400/40 bg-yellow-500/10 text-yellow-300" : "border-rose-400/40 bg-rose-500/10 text-rose-300";
  return (
    <div>
      {deals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 py-16 text-center"><p className="text-sm text-white/70">No deals in escrow</p></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{deals.map((d) => <DealCard key={d.id} deal={d} mode="escrow" />)}</div>
      )}
      <div className={`mt-8 rounded-xl border px-5 py-4 ${cls}`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest opacity-70">Buybox Health</p>
        <p className="mt-1 text-lg font-medium">{avgPct == null ? "No cashback data yet" : `Avg Cashback: ${avgPct.toFixed(1)}% across ${withCashback.length} deal${withCashback.length === 1 ? "" : "s"}`}</p>
      </div>
    </div>
  );
}
