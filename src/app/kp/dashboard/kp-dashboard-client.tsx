"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ASSIGNMENT_STATUS_LABELS,
  ROLE_LABELS,
  STRUCTURE_LABELS,
  type AssignmentStatus,
  type KpDeal,
  type KpSreo,
  type UserRole,
  daysSince,
} from "@/lib/types";
import { money } from "@/lib/format";
import { logout } from "@/app/login/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KpDealRich extends KpDeal {
  deal_status: string | null;
  cashback_at_close: number | null;
  escrow_date: string | null;
  deal_created_at: string | null;
}

type Tab = "deals" | "sreo" | "profile";
type IntelTab = "mydeals" | "earnings" | "pipeline";

interface Profile {
  name: string | null;
  email: string | null;
  role: UserRole | null;
  entity: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const grade = (g: number | null) => (g == null ? "—" : `${g}/100`);

const STATUS_BADGE: Record<AssignmentStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  accepted: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  declined: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
};

const DEAL_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  escrow: "bg-blue-500/15 text-blue-300 ring-blue-400/30",
  active: "bg-blue-500/15 text-blue-300 ring-blue-400/30",
  closed: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
};

function projFee(cashback: number | null): string {
  if (cashback == null) return "—";
  return money(cashback * 0.1);
}

function acqBadgeCls(g: number | null): string {
  if (g == null) return "bg-white/10 text-white/50 ring-white/15";
  if (g >= 90) return "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30";
  if (g >= 80) return "bg-[#D4AF37]/15 text-[#D4AF37] ring-[#D4AF37]/40";
  if (g >= 70) return "bg-orange-500/15 text-orange-300 ring-orange-400/30";
  return "bg-rose-500/15 text-rose-300 ring-rose-400/30";
}

function acqLetter(g: number | null): string {
  if (g == null) return "—";
  if (g >= 90) return "A";
  if (g >= 80) return "B";
  if (g >= 70) return "C";
  return g >= 60 ? "D" : "F";
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function KpDashboardClient({
  profile,
  deals,
  sreo,
}: {
  profile: Profile;
  deals: KpDealRich[];
  sreo: KpSreo[];
}) {
  const [tab, setTab] = useState<Tab>("deals");

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Image
            src="/logo-dark.png"
            alt="Portfolio AI"
            width={150}
            height={40}
            className="h-9 w-auto rounded-md"
            priority
          />
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {profile.name ?? profile.email ?? "Key Principal"}
            </span>
            <form action={logout}>
              <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-3xl tracking-tight text-primary">My Dashboard</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          Your deals, your portfolio, your profile.
        </p>

        {/* ── Intelligence section (NEW — sits above existing tabs) ── */}
        <IntelSection deals={deals} />

        {/* ── Existing nav + tabs (unchanged) ── */}
        <nav className="mt-8 flex gap-1 border-b border-border">
          {(
            [
              ["deals", "My Deals"],
              ["sreo", "My SREO"],
              ["profile", "Profile"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-accent text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-6">
          {tab === "deals" && <DealsTab deals={deals} />}
          {tab === "sreo" && <SreoTab sreo={sreo} />}
          {tab === "profile" && <ProfileTab profile={profile} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intelligence section
// ---------------------------------------------------------------------------

function IntelSection({ deals }: { deals: KpDealRich[] }) {
  const [intelTab, setIntelTab] = useState<IntelTab>("mydeals");

  // KPI computations
  const kpis = useMemo(() => {
    const totalDeals = deals.length;
    const feesEarned = deals
      .filter((d) => d.status === "accepted" && d.cashback_at_close != null)
      .reduce((sum, d) => sum + d.cashback_at_close! * 0.1, 0);
    const inEscrow = deals.filter(
      (d) => d.deal_status === "escrow" || d.deal_status === "active",
    ).length;
    const graded = deals.filter((d) => d.acquisition_grade != null);
    const avgGrade =
      graded.length > 0
        ? graded.reduce((s, d) => s + d.acquisition_grade!, 0) / graded.length
        : null;
    return { totalDeals, feesEarned, inEscrow, avgGrade };
  }, [deals]);

  // Chart: cumulative portfolio exposure over time (by month)
  const chartData = useMemo(() => {
    const byMonth: Record<string, number> = {};
    for (const d of deals) {
      if (!d.deal_created_at || d.purchase_price == null) continue;
      const month = d.deal_created_at.slice(0, 7);
      byMonth[month] = (byMonth[month] ?? 0) + d.purchase_price;
    }
    const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
    let cumulative = 0;
    return sorted.map(([month, sum]) => {
      cumulative += sum;
      const [yr, mo] = month.split("-");
      const label = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      return { label, value: cumulative };
    });
  }, [deals]);

  const INTEL_TABS: [IntelTab, string][] = [
    ["mydeals", "My Deals"],
    ["earnings", "Earnings"],
    ["pipeline", "Pipeline"],
  ];

  return (
    <div className="mt-8 space-y-5">
      {/* Section 1 — KPI bar */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total Deals Assigned" value={String(kpis.totalDeals)} />
        <KpiCard label="Total Fees Earned" value={money(kpis.feesEarned)} gold />
        <KpiCard label="Deals In Escrow" value={String(kpis.inEscrow)} />
        <KpiCard
          label="Avg ACQ Grade"
          value={kpis.avgGrade == null ? "—" : String(Math.round(kpis.avgGrade))}
        />
      </div>

      {/* Section 2 — Exposure chart */}
      <div className="rounded-xl border border-white/10 bg-[#1a1f2e] p-5">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Portfolio Exposure Over Time
        </p>
        {chartData.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center">
            <p className="text-sm text-white/30">No deal data yet.</p>
          </div>
        ) : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
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
                    background: "#0d1117",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 12,
                  }}
                  formatter={(v) => [money(Number(v)), "Cumulative Exposure"]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#D4AF37"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ fill: "#D4AF37", r: 4, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Section 3 — Intelligence tabs */}
      <div>
        <div className="flex gap-0.5 border-b border-white/10">
          {INTEL_TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setIntelTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-medium transition-colors ${
                intelTab === key
                  ? "border-[#D4AF37] text-[#D4AF37]"
                  : "border-transparent text-gray-400 hover:text-white/70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {intelTab === "mydeals" && <IntelDealsTab deals={deals} />}
          {intelTab === "earnings" && <EarningsTab deals={deals} />}
          {intelTab === "pipeline" && <PipelineTab deals={deals} />}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  gold,
}: {
  label: string;
  value: string;
  gold?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1a1f2e] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p
        className={`data-number mt-2 text-2xl font-bold tabular-nums ${gold ? "text-[#D4AF37]" : "text-white"}`}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intel tab 1 — My Deals (with Proj. Fee column)
// ---------------------------------------------------------------------------

function IntelDealsTab({ deals }: { deals: KpDealRich[] }) {
  if (deals.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/15 py-10 text-center">
        <p className="text-sm text-white/50">No deals assigned yet.</p>
      </div>
    );

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-[13px]">
        <thead className="border-b border-white/10 bg-white/5 text-[10px] uppercase tracking-widest text-gray-400">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Address</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Purchase</th>
            <th className="px-4 py-3 text-right font-medium">ARV</th>
            <th className="px-4 py-3 text-right font-medium">ACQ</th>
            <th className="px-4 py-3 text-right font-medium">Proj. Fee</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {deals.map((d) => (
            <tr key={d.assignment_id} className="hover:bg-white/5">
              <td className="px-4 py-3 text-white">{d.property_address}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                    STATUS_BADGE[d.status] ?? "bg-white/10 text-white/50 ring-white/15"
                  }`}
                >
                  {ASSIGNMENT_STATUS_LABELS[d.status]}
                </span>
              </td>
              <td className="data-number px-4 py-3 text-right tabular-nums text-white/70">
                {d.purchase_price ? money(d.purchase_price) : "—"}
              </td>
              <td className="data-number px-4 py-3 text-right tabular-nums text-white/70">
                {d.arv ? money(d.arv) : "—"}
              </td>
              <td className="data-number px-4 py-3 text-right tabular-nums text-white/70">
                {d.acquisition_grade ?? "—"}
              </td>
              <td className="data-number px-4 py-3 text-right tabular-nums text-[#D4AF37]">
                {projFee(d.cashback_at_close)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intel tab 2 — Earnings
// ---------------------------------------------------------------------------

function EarningsTab({ deals }: { deals: KpDealRich[] }) {
  const today = Date.now();

  if (deals.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/15 py-10 text-center">
        <p className="text-sm text-white/50">No deals yet.</p>
      </div>
    );

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-[13px]">
        <thead className="border-b border-white/10 bg-white/5 text-[10px] uppercase tracking-widest text-gray-400">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Address</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Proj. Fee</th>
            <th className="px-4 py-3 text-right font-medium">Escrow Date</th>
            <th className="px-4 py-3 text-right font-medium">Days to Close</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {deals.map((d) => {
            const escrowMs = d.escrow_date ? new Date(d.escrow_date).getTime() : null;
            const daysToClose = escrowMs
              ? Math.ceil((escrowMs - today) / 86_400_000)
              : null;
            const statusKey = d.deal_status ?? "pending";
            return (
              <tr key={d.assignment_id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-white">{d.property_address}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                      DEAL_STATUS_BADGE[statusKey] ?? "bg-white/10 text-white/50 ring-white/15"
                    }`}
                  >
                    {statusKey}
                  </span>
                </td>
                <td className="data-number px-4 py-3 text-right tabular-nums text-[#D4AF37]">
                  {projFee(d.cashback_at_close)}
                </td>
                <td className="data-number px-4 py-3 text-right tabular-nums text-white/70">
                  {d.escrow_date
                    ? new Date(d.escrow_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                </td>
                <td
                  className={`data-number px-4 py-3 text-right tabular-nums ${
                    daysToClose == null
                      ? "text-white/40"
                      : daysToClose < 0
                      ? "text-rose-400"
                      : "text-emerald-400"
                  }`}
                >
                  {daysToClose == null
                    ? "—"
                    : daysToClose < 0
                    ? `${Math.abs(daysToClose)}d overdue`
                    : `${daysToClose}d`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intel tab 3 — Pipeline
// ---------------------------------------------------------------------------

function PipelineTab({ deals }: { deals: KpDealRich[] }) {
  const pipeline = deals.filter(
    (d) => d.deal_status === "pending" || d.deal_status === "escrow" || d.deal_status === "active",
  );

  if (pipeline.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/15 py-10 text-center">
        <p className="text-sm text-white/50">No active pipeline deals.</p>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {pipeline.map((d) => {
        const days = d.deal_created_at ? daysSince(d.deal_created_at) : null;
        return (
          <div
            key={d.assignment_id}
            className="rounded-xl border border-white/10 bg-[#1a1f2e] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-white leading-snug">{d.property_address}</p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                  acqBadgeCls(d.acquisition_grade)
                }`}
              >
                ACQ {acqLetter(d.acquisition_grade)}
                {d.acquisition_grade != null && (
                  <span className="ml-1 opacity-70">{d.acquisition_grade}</span>
                )}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px]">
              <span className="text-gray-400">
                {STRUCTURE_LABELS[d.structure_type] ?? d.structure_type}
              </span>
              <span className="text-white/50">
                {days != null ? `${days}d in pipeline` : "—"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="data-number tabular-nums text-white/70">
                {d.purchase_price ? money(d.purchase_price) : "—"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                  DEAL_STATUS_BADGE[d.deal_status ?? "pending"] ??
                  "bg-white/10 text-white/50 ring-white/15"
                }`}
              >
                {d.deal_status ?? "pending"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing DealsTab + DealCard (unchanged)
// ---------------------------------------------------------------------------

function DealsTab({ deals }: { deals: KpDeal[] }) {
  const pending = deals.filter((d) => d.status === "pending");
  const decided = deals.filter((d) => d.status !== "pending");

  if (deals.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
        <p className="text-sm font-medium text-primary">No deals assigned yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          You&apos;ll see deals here when the team invites you onto one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Awaiting your response
          </h2>
          <div className="space-y-3">
            {pending.map((d) => (
              <DealCard key={d.assignment_id} deal={d} actionable />
            ))}
          </div>
        </section>
      )}
      {decided.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            History
          </h2>
          <div className="space-y-3">
            {decided.map((d) => (
              <DealCard key={d.assignment_id} deal={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DealCard({ deal, actionable }: { deal: KpDeal; actionable?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function respond(action: AssignmentStatus) {
    setError("");
    start(async () => {
      const r = await fetch("/api/kp/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deal.assignment_id, action }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not record your response.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-primary">{deal.property_address}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {STRUCTURE_LABELS[deal.structure_type] ?? deal.structure_type}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${STATUS_BADGE[deal.status]}`}
        >
          {ASSIGNMENT_STATUS_LABELS[deal.status]}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Field label="Purchase" value={money(deal.purchase_price)} />
        <Field label="ARV" value={money(deal.arv)} />
        <Field label="ACQ" value={grade(deal.acquisition_grade)} />
        <Field label="STAB" value={grade(deal.stabilization_grade)} />
      </div>

      {actionable && (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={pending}
            onClick={() => respond("accepted")}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            disabled={pending}
            onClick={() => respond("declined")}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            Decline
          </button>
          {error && <span className="text-xs text-rose-400">{error}</span>}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="data-number tabular-nums text-primary">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing SreoTab (unchanged)
// ---------------------------------------------------------------------------

const EMPTY_SREO = {
  property_name: "",
  property_type: "",
  address: "",
  value: "",
  mortgage_balance: "",
  monthly_payment: "",
};

function SreoTab({ sreo }: { sreo: KpSreo[] }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_SREO);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    setError("");
    start(async () => {
      const r = await fetch("/api/kp/sreo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not add the property.");
        return;
      }
      setForm(EMPTY_SREO);
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      await fetch(`/api/kp/sreo?id=${id}`, { method: "DELETE" });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Schedule of Real Estate Owned
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          {open ? "Cancel" : "Add Property"}
        </button>
      </div>

      {open && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SreoInput label="Property name *" value={form.property_name} onChange={(v) => setForm({ ...form, property_name: v })} />
            <SreoInput label="Type" value={form.property_type} onChange={(v) => setForm({ ...form, property_type: v })} placeholder="SFR, multifamily…" />
            <SreoInput label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} className="sm:col-span-2" />
            <SreoInput label="Value" value={form.value} onChange={(v) => setForm({ ...form, value: v })} type="number" />
            <SreoInput label="Mortgage balance" value={form.mortgage_balance} onChange={(v) => setForm({ ...form, mortgage_balance: v })} type="number" />
            <SreoInput label="Monthly payment" value={form.monthly_payment} onChange={(v) => setForm({ ...form, monthly_payment: v })} type="number" />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              disabled={pending}
              onClick={submit}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              Save Property
            </button>
            {error && <span className="text-xs text-rose-400">{error}</span>}
          </div>
        </div>
      )}

      {sreo.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-primary">No properties yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add the real estate you own to build your SREO.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 text-right font-medium">Mortgage</th>
                <th className="px-4 py-3 text-right font-medium">Monthly</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sreo.map((p) => (
                <tr key={p.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium text-primary">{p.property_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.property_type ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.address ?? "—"}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{money(p.value)}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{money(p.mortgage_balance)}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{money(p.monthly_payment)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(p.id)}
                      disabled={pending}
                      className="text-xs text-muted-foreground hover:text-rose-400 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing ProfileTab (unchanged)
// ---------------------------------------------------------------------------

function ProfileTab({ profile }: { profile: Profile }) {
  return (
    <div className="max-w-md rounded-2xl border border-border bg-card p-6">
      <dl className="space-y-4 text-sm">
        <Row label="Name" value={profile.name ?? "—"} />
        <Row label="Email" value={profile.email ?? "—"} />
        <Row label="Role" value={profile.role ? ROLE_LABELS[profile.role] : "—"} />
        <Row label="Entity" value={profile.entity ?? "—"} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-primary">{value}</dd>
    </div>
  );
}

function SreoInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-primary outline-none focus:border-accent"
      />
    </label>
  );
}
