"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { daysSince } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}

type Tab = "holdings" | "pending" | "escrow";

const GOLD = "#c9a84c";
const PROPERTY_TYPES = ["SFR", "Multifamily", "Commercial", "Land"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eqColor(n: number | null): string {
  if (n == null) return "text-white/60";
  return n >= 0 ? "text-emerald-400" : "text-rose-400";
}

function letterGrade(n: number | null): { letter: string; cls: string } {
  if (n == null) return { letter: "—", cls: "bg-white/10 text-white/50 ring-white/15" };
  if (n >= 90) return { letter: "A", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" };
  if (n >= 80) return { letter: "B", cls: "bg-[#c9a84c]/15 text-[#e6ce86] ring-[#c9a84c]/40" };
  if (n >= 70) return { letter: "C", cls: "bg-orange-500/15 text-orange-300 ring-orange-400/30" };
  return { letter: n >= 60 ? "D" : "F", cls: "bg-rose-500/15 text-rose-300 ring-rose-400/30" };
}

function updatedLabel(iso: string | null): string {
  if (!iso) return "Updating…";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
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
}: {
  pending: PortfolioDeal[];
  escrow: PortfolioDeal[];
}) {
  const [tab, setTab] = useState<Tab>("holdings");

  const TABS: [Tab, string][] = [
    ["holdings", "Current Holdings"],
    ["pending", "Pending Pipeline"],
    ["escrow", "Escrow Pipeline"],
  ];

  return (
    <div className="min-h-screen bg-[#0a1628] px-8 py-8 text-white">
      <header className="mx-auto max-w-6xl">
        <h1 className="text-3xl tracking-tight text-white">Portfolio</h1>
        <p className="mt-2 text-[15px] font-light text-white/50">
          Holdings, pending pipeline, and deals in escrow.
        </p>

        <nav className="mt-6 flex gap-1 border-b border-white/10">
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
        {tab === "holdings" && <HoldingsTab />}
        {tab === "pending" && <PendingTab deals={pending} />}
        {tab === "escrow" && <EscrowTab deals={escrow} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

function HoldingsTab() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

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

  async function remove(id: string) {
    await fetch(`/api/holdings?id=${id}`, { method: "DELETE" });
    load();
  }

  function exportCsv() {
    const head = [
      "Address",
      "Type",
      "Purchase Price",
      "Zillow AVM",
      "Mortgage Balance",
      "Equity",
      "Monthly Payment",
      "Acquisition Date",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = holdings.map((h) => {
      const equity =
        h.zillow_avm != null && h.mortgage_balance != null
          ? h.zillow_avm - h.mortgage_balance
          : "";
      return [
        h.address,
        h.property_type ?? "",
        h.purchase_price ?? "",
        h.zillow_avm ?? "",
        h.mortgage_balance ?? "",
        equity,
        h.monthly_payment ?? "",
        h.acquisition_date ?? "",
      ].map(esc).join(",");
    });
    const csv = [head.join(","), ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
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
        <button
          onClick={() => setModal(true)}
          className="rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a1628] hover:opacity-90"
        >
          + Add New Holding
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-white/50">Loading holdings…</p>
      ) : holdings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 py-16 text-center">
          <p className="text-sm text-white/70">No holdings yet</p>
          <p className="mt-1 text-xs text-white/40">Add a property to start tracking equity.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {holdings.map((h) => (
            <HoldingCard key={h.id} h={h} onDelete={() => remove(h.id)} />
          ))}
        </div>
      )}

      {modal && <AddHoldingModal onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}

function HoldingCard({ h, onDelete }: { h: Holding; onDelete: () => void }) {
  const equity =
    h.zillow_avm != null && h.mortgage_balance != null ? h.zillow_avm - h.mortgage_balance : null;

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-lg leading-snug text-white">{h.address}</h3>
        {h.property_type && (
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white/70">
            {h.property_type}
          </span>
        )}
      </div>

      <div className="mt-4">
        <p className="data-number text-2xl font-medium text-[#c9a84c]">
          {h.zillow_avm != null ? money(h.zillow_avm) : "—"}
        </p>
        <p className="mt-0.5 text-[11px] text-white/40">
          Zillow AVM · {updatedLabel(h.zillow_last_pulled)}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4 text-sm">
        <Stat label="Equity" value={equity != null ? money(equity) : "—"} valueCls={eqColor(equity)} />
        <Stat label="Monthly Payment" value={money(h.monthly_payment)} />
        <Stat label="Purchase Price" value={money(h.purchase_price)} />
        <Stat
          label="Days Held"
          value={h.acquisition_date ? `${daysSince(h.acquisition_date)}d` : "—"}
        />
      </dl>

      {h.notes && <p className="mt-4 text-xs leading-relaxed text-white/60">{h.notes}</p>}

      <div className="mt-4 flex justify-end">
        <button
          onClick={onDelete}
          className="text-xs text-white/40 transition-colors hover:text-rose-400"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueCls = "text-white",
}: {
  label: string;
  value: string;
  valueCls?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-white/40">{label}</dt>
      <dd className={`data-number mt-0.5 tabular-nums ${valueCls}`}>{value}</dd>
    </div>
  );
}

function AddHoldingModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    address: "",
    property_type: "SFR",
    purchase_price: "",
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
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Could not save the holding.");
        return;
      }
      onSaved();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0a1628] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl text-white">Add Holding</h2>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Address *" value={form.address} onChange={set("address")} className="sm:col-span-2" />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">Property Type</span>
            <select
              value={form.property_type}
              onChange={(e) => set("property_type")(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#c9a84c]"
            >
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t} className="bg-[#0a1628]">
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Field label="Purchase Price" value={form.purchase_price} onChange={set("purchase_price")} type="number" />
          <Field label="Acquisition Date" value={form.acquisition_date} onChange={set("acquisition_date")} type="date" />
          <Field label="Mortgage Balance" value={form.mortgage_balance} onChange={set("mortgage_balance")} type="number" />
          <Field label="Monthly Payment" value={form.monthly_payment} onChange={set("monthly_payment")} type="number" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">Notes</span>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#c9a84c]"
            />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:text-white">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !form.address.trim()}
            className="rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a1628] hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Holding"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#c9a84c]"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Deal cards (pending + escrow share most fields)
// ---------------------------------------------------------------------------

function GradeBadge({ label, value }: { label: string; value: number | null }) {
  const g = letterGrade(value);
  return (
    <span
      title={value != null ? `${label} ${value}/100` : `${label} ungraded`}
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${g.cls}`}
    >
      {label} {g.letter}
      {value != null && <span className="ml-1 opacity-70">{value}</span>}
    </span>
  );
}

function DealCard({ deal, mode }: { deal: PortfolioDeal; mode: "pending" | "escrow" }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [acqFee, setAcqFee] = useState(
    deal.purchase_price != null ? Math.round(deal.purchase_price * 0.03) : 0,
  );
  const [editingFee, setEditingFee] = useState(false);
  const [cashback, setCashback] = useState<string>(
    deal.cashback_at_close != null ? String(deal.cashback_at_close) : "",
  );

  const equitySpread =
    deal.arv != null && deal.purchase_price != null ? deal.arv - deal.purchase_price : null;
  const cbNum = cashback === "" ? null : Number(cashback);
  const cbPct =
    cbNum != null && deal.purchase_price ? (cbNum / deal.purchase_price) * 100 : null;

  function saveCashback() {
    start(async () => {
      await fetch("/api/deals/escrow", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id, cashback_at_close: cashback === "" ? null : cbNum }),
      });
      router.refresh();
    });
  }

  function moveToEscrow() {
    start(async () => {
      await fetch("/api/deals/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id }),
      });
      router.refresh();
    });
  }

  const days =
    mode === "escrow" && deal.escrow_date
      ? daysSince(deal.escrow_date)
      : daysSince(deal.created_at);

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
        <Stat
          label={mode === "escrow" ? "Days in Escrow" : "Days in Pending"}
          value={`${days}d`}
        />
      </dl>

      {/* Projected ACQ fee — editable inline (local) */}
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-sm">
        <span className="text-[10px] uppercase tracking-widest text-white/40">Projected ACQ Fee</span>
        {editingFee ? (
          <input
            autoFocus
            type="number"
            value={acqFee}
            onChange={(e) => setAcqFee(Number(e.target.value))}
            onBlur={() => setEditingFee(false)}
            className="w-28 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-right text-sm text-white outline-none focus:border-[#c9a84c]"
          />
        ) : (
          <button
            onClick={() => setEditingFee(true)}
            className="data-number tabular-nums text-white hover:text-[#c9a84c]"
            title="Click to edit"
          >
            {money(acqFee)}
          </button>
        )}
      </div>

      {/* Cashback at close */}
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-[10px] uppercase tracking-widest text-white/40">Cashback at Close</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-white/15 bg-white/5 px-2 py-1">
            <span className="text-white/40">$</span>
            <input
              type="number"
              value={cashback}
              onChange={(e) => setCashback(e.target.value)}
              onBlur={saveCashback}
              placeholder="0"
              className="w-24 bg-transparent px-1 text-right text-sm text-white outline-none"
            />
          </div>
          {cbPct != null && (
            <span className="rounded-full bg-[#c9a84c]/15 px-2 py-1 text-[10px] font-semibold text-[#e6ce86] ring-1 ring-inset ring-[#c9a84c]/40">
              {cbPct.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {mode === "escrow" && deal.escrow_date && (
        <p className="mt-3 text-[11px] text-white/40">
          In escrow since {new Date(deal.escrow_date).toLocaleDateString("en-US")}
        </p>
      )}

      {mode === "pending" && (
        <button
          onClick={moveToEscrow}
          disabled={busy}
          className="mt-4 rounded-lg bg-[#c9a84c] px-4 py-2 text-xs font-semibold text-[#0a1628] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Moving…" : "Move to Escrow"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending + Escrow tabs
// ---------------------------------------------------------------------------

function PendingTab({ deals }: { deals: PortfolioDeal[] }) {
  if (deals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 py-16 text-center">
        <p className="text-sm text-white/70">No pending deals</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {deals.map((d) => (
        <DealCard key={d.id} deal={d} mode="pending" />
      ))}
    </div>
  );
}

function EscrowTab({ deals }: { deals: PortfolioDeal[] }) {
  const withCashback = deals.filter((d) => d.cashback_at_close != null && d.purchase_price);
  const avgPct =
    withCashback.length > 0
      ? withCashback.reduce(
          (sum, d) => sum + (d.cashback_at_close! / d.purchase_price!) * 100,
          0,
        ) / withCashback.length
      : null;

  const buyboxCls =
    avgPct == null
      ? "border-white/15 text-white/60"
      : avgPct >= 3
        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
        : avgPct >= 1
          ? "border-yellow-400/40 bg-yellow-500/10 text-yellow-300"
          : "border-rose-400/40 bg-rose-500/10 text-rose-300";

  return (
    <div>
      {deals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 py-16 text-center">
          <p className="text-sm text-white/70">No deals in escrow</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {deals.map((d) => (
            <DealCard key={d.id} deal={d} mode="escrow" />
          ))}
        </div>
      )}

      <div className={`mt-8 rounded-xl border px-5 py-4 ${buyboxCls}`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest opacity-70">Buybox Health</p>
        <p className="mt-1 text-lg font-medium">
          {avgPct == null
            ? "No cashback data yet"
            : `Avg Cashback: ${avgPct.toFixed(1)}% across ${withCashback.length} deal${withCashback.length === 1 ? "" : "s"}`}
        </p>
      </div>
    </div>
  );
}
