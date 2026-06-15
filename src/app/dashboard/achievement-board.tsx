"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Range = "this_week" | "this_month" | "all_time";
type ChartTab = "deals" | "volume" | "fees";

interface Wholesaler {
  email: string;
  deals: number;
  volume: number;
  fees: number;
  sellers: number;
}
interface TrendPoint {
  week: string;
  deals: number;
  volume: number;
  fees: number;
}
interface MixItem {
  type: string;
  count: number;
  pct: number;
}
interface ActivityItem {
  id: string;
  action: string;
  note: string | null;
  created_at: string;
  address: string | null;
  cashback: number | null;
}
interface Metrics {
  dealsClosed: number;
  totalCashback: number;
  totalFees: number;
  sellersHelped: number;
  growth: number | null;
  topWholesalers: Wholesaler[];
  maxDeals: number;
  trend: TrendPoint[];
  dealMix: MixItem[];
  activity: ActivityItem[];
}

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const MIX_COLORS = [
  "#C9A84C",
  "#EBB66A",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ef4444",
];

const RANGE_LABELS: Record<Range, string> = {
  this_week: "This Week",
  this_month: "This Month",
  all_time: "All Time",
};

const CHART_KEY: Record<ChartTab, keyof TrendPoint> = {
  deals: "deals",
  volume: "volume",
  fees: "fees",
};

function initials(email: string): string {
  const name = email.split("@")[0].replace(/[._]/g, " ");
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Rank badge styles: #1 gold, #2 silver-gray, #3 bronze-gray
const RANK_STYLES = [
  { bg: "rgba(201,168,76,0.15)", color: "#C9A84C", border: "1px solid rgba(201,168,76,0.3)" },
  { bg: "rgba(180,180,180,0.1)", color: "#9ca3af", border: "none" },
  { bg: "rgba(180,120,60,0.1)", color: "#9ca3af", border: "none" },
];

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1d27] px-3 py-2 text-xs">
      <div className="text-white/50 mb-1">{label}</div>
      <div className="text-[#EBB66A] font-mono font-semibold">{payload[0].value}</div>
    </div>
  );
}

// Counts from 0 to target over `duration` ms with ease-out-cubic easing.
// Resets whenever target changes (e.g. new data loads).
function useCountUp(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    setValue(0);
    if (target === 0) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

export function AchievementBoard() {
  const [range, setRange] = useState<Range>("all_time");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaderTab, setLeaderTab] = useState<"deals" | "volume" | "fees" | "sellers">("deals");
  const [chartTab, setChartTab] = useState<ChartTab>("deals");

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/metrics?range=${r}`);
      if (res.ok) setMetrics(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  const m = metrics;

  const handleRange = (r: Range) => {
    setRange(r);
  };

  // Leaderboard sort
  const leaders = [...(m?.topWholesalers ?? [])].sort((a, b) => {
    if (leaderTab === "deals") return b.deals - a.deals;
    if (leaderTab === "volume") return b.volume - a.volume;
    if (leaderTab === "fees") return b.fees - a.fees;
    return b.sellers - a.sellers;
  });
  const maxLeaderVal = leaders[0]
    ? leaderTab === "deals"
      ? leaders[0].deals
      : leaderTab === "volume"
      ? leaders[0].volume
      : leaderTab === "fees"
      ? leaders[0].fees
      : leaders[0].sellers
    : 1;

  // Flat baseline when no trend data
  const trendData = (m?.trend ?? []).length > 0
    ? m!.trend
    : [{ week: "", deals: 0, volume: 0, fees: 0 }, { week: "", deals: 0, volume: 0, fees: 0 }];

  return (
    <div className="space-y-5">
      {/* ── Section 1: Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ color: "#fff", fontFamily: "var(--font-display), serif", fontWeight: 300 }}
            >
              Achievement Board
            </h1>
            <p className="text-xs text-white/40 mt-0.5">Real Estate KPIs</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22c55e]/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-[#22c55e]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            Live
          </span>
        </div>

        {/* Time toggles */}
        <div className="flex rounded-xl border border-white/10 bg-[#1a1d27] p-1">
          {(["this_week", "this_month", "all_time"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => handleRange(r)}
              className="rounded-lg px-4 py-1.5 text-xs font-medium transition-all"
              style={
                range === r
                  ? {
                      background: "linear-gradient(135deg, #C9A84C, #EBB66A)",
                      color: "#0A0B14",
                    }
                  : { color: "rgba(255,255,255,0.45)" }
              }
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Section 2: Metric Cards ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          icon={<TrophyIcon />}
          iconBg="rgba(201,168,76,0.12)"
          iconColor="#C9A84C"
          label="Deals Closed"
          rawValue={m?.dealsClosed ?? 0}
          formatter={(n) => String(n)}
          growth={m?.growth ?? null}
          loading={loading}
        />
        <MetricCard
          icon={<ChartIcon />}
          iconBg="rgba(201,168,76,0.12)"
          iconColor="#C9A84C"
          label="Total Cashback"
          rawValue={m?.totalCashback ?? 0}
          formatter={fmt$}
          growth={null}
          loading={loading}
        />
        <MetricCard
          icon={<DollarIcon />}
          iconBg="rgba(59,130,246,0.12)"
          iconColor="#3b82f6"
          label="Fees Paid Out"
          rawValue={m?.totalFees ?? 0}
          formatter={fmt$}
          growth={null}
          loading={loading}
        />
        <MetricCard
          icon={<PeopleIcon />}
          iconBg="rgba(34,197,94,0.12)"
          iconColor="#22c55e"
          label="Sellers Helped"
          rawValue={m?.sellersHelped ?? 0}
          formatter={(n) => String(n)}
          growth={null}
          loading={loading}
        />
      </div>

      {/* ── Section 3: Leaderboard + Chart ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-10">
        {/* Left 70%: Top Wholesalers */}
        <div
          className="lg:col-span-7 glass-card p-5"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="label-eyebrow">Top Wholesalers</span>
            <div className="flex rounded-lg border border-white/10 p-0.5">
              {(["deals", "volume", "fees", "sellers"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setLeaderTab(t)}
                  className="rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-all"
                  style={
                    leaderTab === t
                      ? { background: "rgba(201,168,76,0.2)", color: "#EBB66A" }
                      : { color: "rgba(255,255,255,0.3)" }
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {leaders.length === 0 ? (
            <p className="text-sm text-white/20 py-6 text-center">No data yet.</p>
          ) : (
            <ol className="space-y-3">
              {leaders.map((w, i) => {
                const val =
                  leaderTab === "deals"
                    ? w.deals
                    : leaderTab === "volume"
                    ? w.volume
                    : leaderTab === "fees"
                    ? w.fees
                    : w.sellers;
                const pct = maxLeaderVal > 0 ? (val / maxLeaderVal) * 100 : 0;
                const dispVal =
                  leaderTab === "deals" || leaderTab === "sellers"
                    ? String(val)
                    : fmt$(val);
                const rank = RANK_STYLES[i];
                return (
                  <li key={w.email} className="flex items-center gap-3">
                    {/* Rank badge / avatar */}
                    {i < 3 ? (
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: "999px",
                          fontSize: "10px",
                          fontWeight: 700,
                          flexShrink: 0,
                          background: rank.bg,
                          color: rank.color,
                          border: rank.border,
                          letterSpacing: "0.04em",
                        }}
                      >
                        #{i + 1}
                      </span>
                    ) : (
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          color: "rgba(255,255,255,0.3)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        {initials(w.email)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="truncate text-xs text-white/70">{w.email}</span>
                        <span
                          className="ml-3 shrink-0 font-mono text-xs font-semibold"
                          style={{ color: "#EBB66A" }}
                        >
                          {dispVal}
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-white/5">
                        <div
                          className="h-1 rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            background:
                              i === 0
                                ? "linear-gradient(90deg, #C9A84C, #EBB66A)"
                                : "#9ca3af",
                          }}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Right 30%: Chart + Deal Mix */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          {/* Trend Chart — always renders; flat baseline when no data */}
          <div className="glass-card p-4 flex-1">
            <div className="mb-3 flex items-center justify-between">
              <span className="label-eyebrow">12-Week Trend</span>
              <div className="flex gap-1">
                {(["deals", "volume", "fees"] as ChartTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartTab(t)}
                    className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-all"
                    style={
                      chartTab === t
                        ? { color: "#EBB66A" }
                        : { color: "rgba(255,255,255,0.25)" }
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ minHeight: "180px" }}>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 9, fill: "rgba(255,255,255,0.2)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey={CHART_KEY[chartTab]}
                    stroke="#EBB66A"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: "#EBB66A" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Deal Mix */}
          <div className="glass-card p-4">
            <div className="label-eyebrow mb-3">Deal Mix</div>
            {(m?.dealMix ?? []).length === 0 ? (
              <p className="text-xs text-white/20 text-center py-2">No data</p>
            ) : (
              <div className="space-y-2">
                {(m?.dealMix ?? []).slice(0, 5).map((item, i) => (
                  <div key={item.type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-white/60 capitalize">
                        {item.type.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-[11px] text-white/40">{item.pct}%</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-white/5">
                      <div
                        className="h-1 rounded-full"
                        style={{
                          width: `${item.pct}%`,
                          background: MIX_COLORS[i % MIX_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

export function LiveActivity() {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  useEffect(() => {
    fetch("/api/dashboard/metrics?range=all_time")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.activity) setActivity(d.activity); });
  }, []);
  return <LiveActivityFeed activity={activity} />;
}

export function LiveActivityFeed({ activity }: { activity: ActivityItem[] }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] animate-pulse" />
        <span className="label-eyebrow">Live Activity</span>
      </div>
      {activity.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-white/20">No activity yet.</p>
      ) : (
        <ul>
          {activity.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-4 px-5 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{ background: "rgba(201,168,76,0.12)", color: "#C9A84C" }}
                  >
                    {a.action.replace(/_/g, " ")}
                  </span>
                  {a.address && (
                    <span className="truncate text-xs text-white/50">{a.address}</span>
                  )}
                </div>
                {a.note && (
                  <div className="mt-0.5 truncate text-[11px] text-white/30">{a.note}</div>
                )}
              </div>
              <div className="shrink-0 text-right">
                {a.cashback != null && (
                  <div className="font-mono text-xs font-semibold" style={{ color: "#22c55e" }}>
                    {fmt$(a.cashback)}
                  </div>
                )}
                <div className="text-[10px] text-white/25">{fmtRelative(a.created_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  rawValue,
  formatter,
  growth,
  loading,
}: {
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  label: string;
  rawValue: number;
  formatter: (n: number) => string;
  growth: number | null;
  loading: boolean;
}) {
  const counted = useCountUp(loading ? 0 : rawValue);
  const display = loading ? "—" : formatter(counted);

  return (
    <div className="glass-card p-5 relative overflow-hidden">
      {/* Subtle icon — top right, gold, 20px, 40% opacity */}
      <div style={{ position: "absolute", top: "16px", right: "16px", color: "#C9A84C", opacity: 0.4 }}>
        {icon}
      </div>

      {growth != null && (
        <div className="mb-3">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              background: growth >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
              color: growth >= 0 ? "#22c55e" : "#ef4444",
            }}
          >
            {growth >= 0 ? "+" : ""}{growth}%
          </span>
        </div>
      )}

      {/* Hero number + gold underline via ::after */}
      <div
        className="num-hero metric-accent"
        style={{ opacity: loading ? 0.3 : 1, transition: "opacity 300ms ease" }}
      >
        {display}
      </div>

      {/* Label */}
      <div className="label-card mt-3">{label}</div>
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}
function DollarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
