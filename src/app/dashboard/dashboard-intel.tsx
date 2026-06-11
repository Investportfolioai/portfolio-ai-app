"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
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
}

const fee = (cashback: number | null, price: number | null) =>
  portfolioAiFee({ cashback_at_close: cashback, purchase_price: price });
const daysBetween = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0;

function gradeBadge(n: number | null, cashback?: number | null): { letter: string; cls: string } {
  if (n == null || (n === 0 && cashback == null))
    return { letter: "—", cls: "bg-secondary text-muted-foreground ring-border" };
  if (n >= 90) return { letter: "A", cls: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30" };
  if (n >= 80) return { letter: "B", cls: "bg-accent/15 text-amber-700 ring-accent/40" };
  if (n >= 70) return { letter: "C", cls: "bg-orange-500/15 text-orange-700 ring-orange-500/30" };
  return { letter: n >= 60 ? "D" : "F", cls: "bg-rose-500/15 text-rose-700 ring-rose-500/30" };
}

export function DashboardIntel() {
  const [intel, setIntel] = useState<Intel | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pipeline/intelligence");
    if (res.ok) setIntel(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const i = intel;

  return (
    <div className="space-y-6">
      {/* Section 1 — KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Close Rate"
          big={`${(i?.close_rate ?? 0).toFixed(0)}%`}
          sub={`${i?.closed_count ?? 0} deals closed of ${i?.worked_count ?? 0} worked`}
          accent
        />
        <Kpi
          label="In Escrow"
          big={String(i?.deals_in_escrow ?? 0)}
          sub={`${money(i?.total_projected_fees ?? 0)} proj fees`}
        />
        <Kpi
          label="Pending"
          big={String(i?.deals_pending ?? 0)}
          sub={
            i == null
              ? "loading…"
              : `${money(i.total_projected_cashback)} proj cashback${
                  i.pending_missing_cashback > 0
                    ? ` · ${i.pending_missing_cashback} need data`
                    : ""
                }`
          }
        />
        <Kpi
          label="Buybox Score"
          big={i?.buybox_score != null ? `${i.buybox_score.toFixed(1)}%` : "—"}
          sub="avg cashback at close"
          accent
        />
      </div>

      {/* Section 2 — pipeline panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-primary">{d.property_address}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${acq.cls}`}>ACQ {acq.letter}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${stab.cls}`}>STAB {stab.letter}</span>
                  <span className="data-number shrink-0 text-xs tabular-nums text-muted-foreground">
                    {d.cashback_at_close != null ? moneyCompact(d.cashback_at_close) : "—"}
                    {cbPct != null ? ` · ${cbPct.toFixed(1)}%` : ""}
                  </span>
                  <span className="data-number shrink-0 text-xs tabular-nums text-muted-foreground">{daysBetween(d.created_at)}d</span>
                  <span className="data-number shrink-0 text-xs tabular-nums text-accent">{money(fee(d.cashback_at_close, d.purchase_price))}</span>
                </div>
              );
            })
          )}
          <ViewAll />
        </Panel>
      </div>

      {/* Section 3 — performance stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Perf label="Avg ACQ Grade" value={i?.avg_acq_grade != null ? i.avg_acq_grade.toFixed(0) : "—"} />
        <Perf label="Avg STAB Grade" value={i?.avg_stab_grade != null ? i.avg_stab_grade.toFixed(0) : "—"} />
        <Perf label="Avg Days to Escrow" value={i?.avg_days_to_escrow != null ? `${i.avg_days_to_escrow.toFixed(0)}d` : "—"} />
      </div>
    </div>
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
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm text-primary">{deal.property_address}</span>
      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-accent/30">
        {daysBetween(deal.escrow_date)}d
      </span>
      <span className="data-number shrink-0 text-xs tabular-nums text-muted-foreground">
        {cbNum != null ? moneyCompact(cbNum) : "—"}
        {cbPct != null ? ` · ${cbPct.toFixed(1)}%` : ""}
      </span>
      <span className="data-number shrink-0 text-xs tabular-nums text-accent">{money(fee(cbNum, deal.purchase_price))}</span>
      <div className="flex shrink-0 items-center rounded-md border border-border bg-secondary px-1.5 py-0.5">
        <span className="text-[11px] text-muted-foreground">$</span>
        <input
          type="number"
          value={cashback}
          disabled={busy}
          onChange={(e) => setCashback(e.target.value)}
          onBlur={save}
          placeholder="—"
          className="w-16 bg-transparent px-1 text-right text-xs text-primary outline-none"
        />
      </div>
    </div>
  );
}

function Kpi({ label, big, sub, accent }: { label: string; big: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`data-number mt-2 text-3xl font-medium tabular-nums ${accent ? "text-accent" : "text-primary"}`}>{big}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-primary">{title}</span>
        <span className="data-number rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{count}</span>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function ViewAll() {
  return (
    <Link href="/dashboard/pipeline" className="block px-4 py-2.5 text-center text-xs font-medium text-accent hover:underline">
      View all in Pipeline →
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function Perf({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="data-number mt-2 text-2xl font-medium tabular-nums text-primary">{value}</div>
    </div>
  );
}
