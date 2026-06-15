"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
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
      {/* KPI row */}
      <KpiRow intel={i} />

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

function KpiRow({ intel }: { intel: Intel | null }) {
  const i = intel;
  const closeRateRaw = i?.close_rate ?? 0;
  const escrowRaw = i?.escrow_count ?? i?.deals_in_escrow ?? 0;
  const pendingRaw = i?.pending_count ?? i?.deals_pending ?? 0;
  const buyboxRaw = i?.buybox_score ?? 0;

  const closeRate = useCountUp(closeRateRaw);
  const escrow = useCountUp(escrowRaw);
  const pending = useCountUp(pendingRaw);
  const buybox = useCountUp(buyboxRaw);

  const closeColor = closeRateRaw > 20 ? "#22c55e" : closeRateRaw > 10 ? "#C9A84C" : "#f59e0b";
  const buyboxColor = buyboxRaw > 20 ? "#22c55e" : buyboxRaw > 10 ? "#C9A84C" : "#f59e0b";

  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 overflow-hidden rounded-xl"
      style={{ background: "rgba(26,29,39,0.7)", border: "1px solid rgba(255,255,255,0.05)" }}
    >
      <KpiStat
        label="Close Rate"
        value={`${Math.round(closeRate)}%`}
        sub={`${i?.closed_count ?? 0} of ${i?.worked_count ?? 0} worked`}
        valueColor={closeColor}
      />
      <KpiStat
        label="In Escrow"
        value={String(Math.round(escrow))}
        sub={i == null ? "—" : `${compactMoney(i.escrow_cashback)} proj cashback`}
        sub2={i == null ? "" : `${compactMoney(i.escrow_fees)} proj fees`}
        divider
      />
      <KpiStat
        label="Pending"
        value={String(Math.round(pending))}
        sub={i == null ? "—" : `${compactMoney(i.pending_cashback)} proj cashback`}
        sub2={i == null ? "" : `${compactMoney(i.pending_fees)} proj fees`}
        divider
      />
      <KpiStat
        label="Cashback Rate"
        value={i != null && i.buybox_score == null ? "—" : `${buybox.toFixed(1)}%`}
        sub="avg · deals in escrow"
        valueColor={i?.buybox_score != null ? buyboxColor : undefined}
        divider
      />
    </div>
  );
}

function KpiStat({
  label,
  value,
  sub,
  sub2,
  valueColor,
  divider,
}: {
  label: string;
  value: string;
  sub?: string;
  sub2?: string;
  valueColor?: string;
  divider?: boolean;
}) {
  return (
    <div
      style={{
        padding: "20px 20px 18px",
        borderLeft: divider ? "1px solid rgba(255,255,255,0.05)" : undefined,
      }}
    >
      <div className="label-card mb-3">{label}</div>
      <div className="num-metric" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {sub && <div className="label-sub mt-2 truncate">{sub}</div>}
      {sub2 && <div className="label-sub mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.18)" }}>{sub2}</div>}
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "rgba(26,29,39,0.85)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
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
    const prevNum = deal.cashback_at_close;
    const num = cashback === "" ? null : cbNum;
    start(async () => {
      const res = await fetch("/api/deals/escrow", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id, cashback_at_close: num }),
      });
      if (!res.ok) {
        toast.error("Failed to save — check connection and retry");
        setCashback(prevNum != null ? String(prevNum) : "");
        return;
      }
      onSaved();
      toast("Cashback updated", {
        action: {
          label: "Undo",
          onClick: async () => {
            await fetch("/api/deals/escrow", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deal_id: deal.id, cashback_at_close: prevNum }),
            });
            onSaved();
          },
        },
        duration: 5000,
      });
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
          aria-label="Cashback at close"
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

