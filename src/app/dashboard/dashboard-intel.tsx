"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { money, moneyCompact } from "@/lib/format";
import { portfolioAiFee } from "@/lib/types";

interface EscrowDeal {
  id: string;
  property_address: string;
  escrow_date: string | null;
  purchase_price: number | null;
  cashback_at_close: number | null;
  acquisition_grade: number | null;
}
interface PendingDeal {
  id: string;
  property_address: string;
  created_at: string;
  purchase_price: number | null;
  acquisition_grade: number | null;
  stabilization_grade: number | null;
  cashback_at_close: number | null;
}
interface Intel {
  total_projected_fees: number;
  total_projected_cashback: number;
  avg_acq_grade: number | null;
  avg_stab_grade: number | null;
  close_rate: number;
  closed_count: number;
  worked_count: number;
  avg_days_to_escrow: number | null;
  buybox_score: number | null;
  deals_in_escrow: number;
  deals_pending: number;
  escrow_deals: EscrowDeal[];
  pending_deals: PendingDeal[];
  pending_missing_cashback: number;
  escrow_count: number;
  escrow_cashback: number;
  escrow_fees: number;
  pending_count: number;
  pending_cashback: number;
  pending_fees: number;
}

const fee = (cashback: number | null, price: number | null) =>
  portfolioAiFee({ cashback_at_close: cashback, purchase_price: price });

function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

const daysBetween = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0;

function gradeBadge(n: number | null, cashback?: number | null) {
  if (n == null || (n === 0 && cashback == null))
    return { letter: "—", bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)", ring: "rgba(255,255,255,0.1)" };
  if (n >= 90) return { letter: "A", bg: "rgba(34,197,94,0.12)", color: "#22c55e", ring: "rgba(34,197,94,0.25)" };
  if (n >= 80) return { letter: "B", bg: "rgba(201,168,76,0.12)", color: "#C9A84C", ring: "rgba(201,168,76,0.25)" };
  if (n >= 70) return { letter: "C", bg: "rgba(249,115,22,0.12)", color: "#f97316", ring: "rgba(249,115,22,0.25)" };
  return { letter: n >= 60 ? "D" : "F", bg: "rgba(239,68,68,0.12)", color: "#ef4444", ring: "rgba(239,68,68,0.25)" };
}

const CARD = {} as const;
const DIVIDER = { borderColor: "rgba(255,255,255,0.05)" } as const;

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
      setValue(target * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
}

export function DashboardIntel() {
  const [intel, setIntel] = useState<Intel | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pipeline/intelligence");
    if (res.ok) setIntel(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  const i = intel;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<TargetIcon />}
          label="Close Rate"
          numericValue={i?.close_rate ?? 0}
          valueFmt={(n) => `${Math.round(n)}%`}
          sub={`${i?.closed_count ?? 0} of ${i?.worked_count ?? 0} worked`}
        />
        <KpiCard
          icon={<EscrowIcon />}
          label="In Escrow"
          numericValue={i?.escrow_count ?? i?.deals_in_escrow ?? 0}
          valueFmt={(n) => String(Math.round(n))}
          sub={i == null ? "loading…" : `${compactMoney(i.escrow_cashback)} proj cashback`}
          sub2={i == null ? "" : `${compactMoney(i.escrow_fees)} proj fees`}
        />
        <KpiCard
          icon={<ClockIcon />}
          label="Pending"
          numericValue={i?.pending_count ?? i?.deals_pending ?? 0}
          valueFmt={(n) => String(Math.round(n))}
          sub={i == null ? "loading…" : `${compactMoney(i.pending_cashback)} proj cashback`}
          sub2={i == null ? "" : `${compactMoney(i.pending_fees)} proj fees`}
        />
        <KpiCard
          icon={<StarIcon />}
          label="Buybox Score"
          numericValue={i?.buybox_score ?? 0}
          valueFmt={(n) => `${n.toFixed(1)}%`}
          displayOverride={i != null && i.buybox_score == null ? "—" : undefined}
          sub="avg cashback at close"
        />
      </div>

      {/* Pipeline panels */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Escrow Pipeline" count={i?.escrow_deals.length ?? 0}>
          {(i?.escrow_deals ?? []).length === 0 ? (
            <Empty>No deals in escrow.</Empty>
          ) : (
            (i?.escrow_deals ?? []).map((d) => (
              <EscrowRow key={d.id} deal={d} onSaved={load} />
            ))
          )}
          <ViewAll />
        </Panel>

        <Panel title="Pending Pipeline" count={i?.pending_deals.length ?? 0}>
          {(i?.pending_deals ?? []).length === 0 ? (
            <Empty>No pending deals.</Empty>
          ) : (
            (i?.pending_deals ?? []).map((d) => {
              const acq = gradeBadge(d.acquisition_grade, d.cashback_at_close);
              const stab = gradeBadge(d.stabilization_grade, d.cashback_at_close);
              const cbPct =
                d.cashback_at_close != null && d.purchase_price
                  ? (d.cashback_at_close / d.purchase_price) * 100
                  : null;
              return (
                <div key={d.id} className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
                    {d.property_address}
                  </span>
                  <GradePill label="ACQ" badge={acq} />
                  <GradePill label="STAB" badge={stab} />
                  <span className="shrink-0 font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {d.cashback_at_close != null ? moneyCompact(d.cashback_at_close) : "—"}
                    {cbPct != null ? ` · ${cbPct.toFixed(1)}%` : ""}
                  </span>
                  <span className="shrink-0 font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    {daysBetween(d.created_at)}d
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-semibold" style={{ color: "#C9A84C" }}>
                    {money(fee(d.cashback_at_close, d.purchase_price))}
                  </span>
                </div>
              );
            })
          )}
          <ViewAll />
        </Panel>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  numericValue,
  valueFmt,
  displayOverride,
  sub,
  sub2,
}: {
  icon: React.ReactNode;
  label: string;
  numericValue: number;
  valueFmt: (n: number) => string;
  displayOverride?: string;
  sub?: string;
  sub2?: string;
}) {
  const counted = useCountUp(numericValue);
  const display = displayOverride ?? valueFmt(counted);
  return (
    <div className="glass-card p-5 relative overflow-hidden">
      {/* Icon: 28px, gold, top-left */}
      <div className="mb-4" style={{ color: "#C9A84C" }}>
        {icon}
      </div>
      {/* Big number */}
      <div style={{
        fontSize: "3rem",
        fontWeight: 200,
        letterSpacing: "-0.03em",
        color: "#fff",
        lineHeight: 1.05,
      }}>
        {display}
      </div>
      {/* Gold underline */}
      <div style={{ width: "32px", height: "2px", background: "#C9A84C", margin: "10px 0 8px" }} />
      {/* Label */}
      <div style={{
        fontSize: "0.6rem",
        fontWeight: 600,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        color: "#6b7280",
      }}>
        {label}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>{sub}</div>}
      {sub2 && <div className="mt-0.5 truncate text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>{sub2}</div>}
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>{title}</span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}
        >
          {count}
        </span>
      </div>
      <div>{children}</div>
    </section>
  );
}

function GradePill({ label, badge }: { label: string; badge: ReturnType<typeof gradeBadge> }) {
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
      style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.ring}` }}
    >
      {label} {badge.letter}
    </span>
  );
}

function EscrowRow({ deal, onSaved }: { deal: EscrowDeal; onSaved: () => void }) {
  const [busy, start] = useTransition();
  const [cashback, setCashback] = useState(deal.cashback_at_close != null ? String(deal.cashback_at_close) : "");
  const cbNum = cashback === "" ? null : Number(cashback);
  const cbPct = cbNum != null && deal.purchase_price ? (cbNum / deal.purchase_price) * 100 : null;

  function save() {
    start(async () => {
      await fetch("/api/deals/escrow", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id, cashback_at_close: cashback === "" ? null : cbNum }),
      });
      onSaved();
    });
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
        {deal.property_address}
      </span>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium"
        style={{ background: "rgba(201,168,76,0.12)", color: "#C9A84C", border: "1px solid rgba(201,168,76,0.25)" }}
      >
        {daysBetween(deal.escrow_date)}d
      </span>
      <span className="shrink-0 font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
        {cbNum != null ? moneyCompact(cbNum) : "—"}
        {cbPct != null ? ` · ${cbPct.toFixed(1)}%` : ""}
      </span>
      <span className="shrink-0 font-mono text-[11px] font-semibold" style={{ color: "#C9A84C" }}>
        {money(fee(cbNum, deal.purchase_price))}
      </span>
      <div
        className="flex shrink-0 items-center rounded-lg px-2 py-1"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>$</span>
        <input
          type="number"
          value={cashback}
          disabled={busy}
          onChange={(e) => setCashback(e.target.value)}
          onBlur={save}
          placeholder="—"
          className="w-16 bg-transparent px-1 text-right text-xs outline-none"
          style={{ color: "rgba(255,255,255,0.7)" }}
        />
      </div>
    </div>
  );
}

function ViewAll() {
  return (
    <Link
      href="/dashboard/pipeline"
      className="block px-4 py-2.5 text-center text-xs font-medium transition-colors hover:opacity-80"
      style={{ color: "#C9A84C", borderTop: "1px solid rgba(255,255,255,0.04)" }}
    >
      View all in Pipeline →
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>{children}</p>;
}

function TargetIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}
function EscrowIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
