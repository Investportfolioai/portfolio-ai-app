"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import {
  type Deal,
  type DealStatus,
  type DealStructure,
  type DealMilestone,
  type MilestoneType,
  type AssignmentStatus,
  type KpAssignment,
  type AvailableKp,
  type WaterfallResult,
  type CashflowResult,
  ASSIGNMENT_STATUS_LABELS,
  MILESTONE_LABELS,
  STATUS_LABELS,
  STRUCTURE_LABELS,
  capitalRunwayMultiple,
  daysSince,
  daysUntil,
  deadDaysRemaining,
  equitySpread,
  portfolioAiFee,
} from "@/lib/types";
import { calculateMorbyWaterfall } from "@/lib/waterfall";
import { money, moneyCompact, updatedLabel } from "@/lib/format";
import {
  acceptDeal,
  rejectDeal,
  negotiateDeal,
  runUnderwriting,
  setRentalStrategy,
  getDealDetail,
  createDeal,
  markDealDead,
  markDealClosed,
  updateDealField,
  updateDealAiField,
  createMilestone,
  deleteMilestone,
  uploadDealDocument,
  type DealDetail,
  type NewDealInput,
  type UploadResult,
} from "./actions";
import {
  assignKpToDeal,
  getDealKpAssignments,
  getAvailableKps,
  removeKpAssignment,
} from "./kp-actions";

type Extraction = Extract<UploadResult, { ok: true }>["extraction"];

const ASSET_TYPES = ["Multifamily", "Commercial", "Mixed Use", "Industrial", "Land"];

const DEAD_REASONS = [
  "Not a fit",
  "Seller unresponsive",
  "Financing fell through",
  "Terms changed",
  "Other",
];

const STATUS_TABS: { key: DealStatus | "all" | "escrow"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "escrow", label: "Escrow" },
  { key: "passed", label: "Passed" },
  { key: "closed", label: "Closed" },
  { key: "dead", label: "Dead" },
];

type StructureFilter = "all" | "ab_bc" | "seller_finance";
const STRUCTURE_FILTERS: [StructureFilter, string][] = [
  ["all", "All"],
  ["ab_bc", "AB→BC"],
  ["seller_finance", "Seller Finance"],
];

interface PipelineIntel {
  total_projected_fees: number;
  total_projected_cashback: number;
  avg_acq_grade: number | null;
  avg_stab_grade: number | null;
  close_rate: number;
  avg_days_to_escrow: number | null;
  buybox_score: number | null;
  deals_in_escrow: number;
  deals_pending: number;
}

/** Collapsible pipeline-intelligence bar (navy, gold numbers) above the tabs. */
function IntelligenceBar() {
  const [open, setOpen] = useState(true);
  const [intel, setIntel] = useState<PipelineIntel | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pipeline/intelligence")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setIntel(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="glass-card mb-4 px-4 py-3 text-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
          Pipeline Intelligence
        </span>
        <span className="text-xs text-white/50">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
          <MiniStat label="Portfolio AI Fees" value={money(intel?.total_projected_fees ?? 0)} />
          <MiniStat label="Proj Cashback" value={money(intel?.total_projected_cashback ?? 0)} />
          <MiniStat label="Close Rate" value={`${(intel?.close_rate ?? 0).toFixed(0)}%`} />
          <MiniStat label="Avg ACQ" value={intel?.avg_acq_grade != null ? intel.avg_acq_grade.toFixed(0) : "—"} />
          <MiniStat label="Avg STAB" value={intel?.avg_stab_grade != null ? intel.avg_stab_grade.toFixed(0) : "—"} />
          <MiniStat label="To Escrow" value={intel?.avg_days_to_escrow != null ? `${intel.avg_days_to_escrow.toFixed(0)}d` : "—"} />
          <MiniStat label="Buybox" value={intel?.buybox_score != null ? `${intel.buybox_score.toFixed(1)}%` : "—"} />
          <MiniStat label="In Escrow" value={String(intel?.deals_in_escrow ?? 0)} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-medium uppercase tracking-widest text-white/40">{label}</div>
      <div className="data-number mt-0.5 text-sm font-medium tabular-nums text-[#c9a84c]">{value}</div>
    </div>
  );
}

export function PipelineBoard({ deals: initialDeals }: { deals: Deal[] }) {
  const [status, setStatus] = useState<DealStatus | "all" | "escrow">("all");
  const [structure, setStructure] = useState<StructureFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const deals = initialDeals.filter((d) => !deletedIds.has(d.id));

  function handleDeleted(id: string) {
    setDeletedIds((prev) => new Set(prev).add(id));
    if (selectedId === id) setSelectedId(null);
  }

  // All = active + pending (excludes dead/passed); Escrow = active w/ escrow_date.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, escrow: 0, pending: 0, passed: 0, closed: 0, dead: 0 };
    for (const d of deals) {
      if (d.status === "active" || d.status === "pending") c.all += 1;
      if (d.status === "active" && d.escrow_date) c.escrow += 1;
      if (d.status === "pending") c.pending += 1;
      if (d.status === "passed") c.passed += 1;
      if (d.status === "closed") c.closed += 1;
      if (d.status === "dead") c.dead += 1;
    }
    return c;
  }, [deals]);

  const filtered = useMemo(() => {
    const matchStatus = (d: Deal) => {
      if (status === "all") return d.status === "active" || d.status === "pending";
      if (status === "escrow") return d.status === "active" && !!d.escrow_date;
      return d.status === status; // pending | passed | dead
    };
    return deals.filter(
      (d) =>
        matchStatus(d) &&
        (structure === "all" || (d.structure_type as string) === structure),
    );
  }, [deals, status, structure]);

  const [adding, setAdding] = useState(false);

  const selected = deals.find((d) => d.id === selectedId) ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <IntelligenceBar />

      {/* Status tabs + Add Deal */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex flex-wrap gap-0">
        {STATUS_TABS.map((t) => {
          const active = status === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className="-mb-px flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors"
              style={{
                borderBottom: active ? "2px solid #C9A84C" : "2px solid transparent",
                color: active ? "#ffffff" : "#52525b",
              }}
            >
              {t.label}
              <span
                className="data-number font-mono text-[0.65rem] rounded px-1.5 py-0.5"
                style={{
                  background: "rgba(26,29,39,0.72)",
                  color: "#C9A84C",
                  border: "1px solid rgba(201,168,76,0.12)",
                }}
              >
                {counts[t.key] ?? 0}
              </span>
            </button>
          );
        })}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn-primary mb-1.5 rounded-full px-4 py-1.5 text-xs"
        >
          + Add Deal
        </button>
      </div>

      {/* Structure chips */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="label-eyebrow w-20 shrink-0">
          Structure
        </span>
        {STRUCTURE_FILTERS.map(([value, label]) => (
          <Chip key={value} active={structure === value} onClick={() => setStructure(value)}>
            {label}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasDeals={deals.length > 0} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((deal) => (
              <motion.div
                key={deal.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              >
                <DealCard
                  deal={deal}
                  onOpen={() => setSelectedId(deal.id)}
                  onDeleted={handleDeleted}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <DealPanel deal={selected} onClose={() => setSelectedId(null)} />
      <AddDealModal open={adding} onClose={() => setAdding(false)} />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Add Deal modal
// ---------------------------------------------------------------------------

function AddDealModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function n(fd: FormData, k: string): number | null {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? null : Number(v);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input: NewDealInput = {
      property_address: String(fd.get("property_address") ?? ""),
      asset_type: String(fd.get("asset_type") ?? ""),
      purchase_price: n(fd, "purchase_price"),
      arv: n(fd, "arv"),
      loan_amount: n(fd, "loan_amount"),
      cash_invested: n(fd, "cash_invested"),
      net_monthly_cashflow: n(fd, "net_monthly_cashflow"),
      annual_gross_revenue: n(fd, "annual_gross_revenue"),
      seller_carry: n(fd, "seller_carry"),
      assignment_fee: n(fd, "assignment_fee"),
      notes: String(fd.get("notes") ?? ""),
      status: (String(fd.get("status") ?? "pending") as NewDealInput["status"]),
    };
    setError(null);
    startTransition(async () => {
      const res = await createDeal(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg text-primary">Add Deal</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
          <ModalField label="Property address" name="property_address" required />
          <ModalSelect label="Asset type" name="asset_type" options={ASSET_TYPES} />
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Purchase price" name="purchase_price" type="number" />
            <ModalField label="ARV" name="arv" type="number" />
            <ModalField label="Loan amount" name="loan_amount" type="number" />
            <ModalField label="Cash invested" name="cash_invested" type="number" />
            <ModalField label="Net monthly cash flow" name="net_monthly_cashflow" type="number" />
            <ModalField label="Annual gross revenue" name="annual_gross_revenue" type="number" />
            <ModalField label="Seller note balance" name="seller_carry" type="number" defaultValue="0" />
            <ModalField label="Assignment fee" name="assignment_fee" type="number" />
            <ModalSelect label="Status" name="status" options={["pending", "active"]} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Notes
            </span>
            <textarea
              name="notes"
              rows={2}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              {pending ? "Adding…" : "Add Deal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalField({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        {...props}
        step={props.type === "number" ? "any" : undefined}
        className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

function ModalSelect({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <select
        name={name}
        defaultValue={options[0]}
        className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.charAt(0).toUpperCase() + o.slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Filters / badges
// ---------------------------------------------------------------------------

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 " +
        (active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/70")
      }
    >
      {children}
    </button>
  );
}

function StructureBadge({
  structure,
  dark,
}: {
  structure: DealStructure;
  dark?: boolean;
}) {
  return (
    <span
      className={
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
        (dark ? "bg-white/10 text-white" : "bg-primary text-primary-foreground")
      }
    >
      {STRUCTURE_LABELS[structure]}
    </span>
  );
}

function StatusBadge({ status }: { status: DealStatus }) {
  const s =
    status === "active" || status === "closed"
      ? { bg: "rgba(34,197,94,0.12)", color: "#22c55e" }
      : status === "passed" || status === "dead"
        ? { bg: "rgba(255,255,255,0.06)", color: "#52525b" }
        : { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" };
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        background: s.bg, color: s.color,
        borderRadius: "999px", padding: "2px 8px",
        fontSize: "10px", fontWeight: 600,
        letterSpacing: "0.08em", textTransform: "uppercase",
      }}
    >
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: s.color, flexShrink: 0 }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function gradeColors(v: number): { bg: string; color: string } {
  if (v >= 80) return { bg: "rgba(34,197,94,0.12)", color: "#22c55e" };
  if (v >= 60) return { bg: "rgba(201,168,76,0.12)", color: "#C9A84C" };
  if (v >= 40) return { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" };
  return { bg: "rgba(239,68,68,0.12)", color: "#ef4444" };
}

function GradeBadge({ caption, value, dim }: { caption: string; value: number; dim?: boolean }) {
  const c = dim ? { bg: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.25)" } : gradeColors(value);
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="data-number flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium tabular-nums"
        style={{ background: c.bg, color: c.color }}
      >
        {dim ? "—" : value}
      </span>
      <span className="text-[8px] font-medium uppercase tracking-widest text-white/40">
        {caption}
      </span>
    </div>
  );
}

/** Shown on cards with no grades yet. */
function PendingGradeBadge() {
  return (
    <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground ring-1 ring-border">
      Pending
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/** LTR / STR segmented toggle. Changing it re-underwrites with the matching comp search. */
function RentalToggle({ deal, onChanged }: { deal: Deal; onChanged?: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const current = deal.rental_strategy ?? "ltr";

  function choose(strategy: "ltr" | "str") {
    if (strategy === current || busy) return;
    start(async () => {
      await setRentalStrategy(deal.id, strategy);
      if (onChanged) onChanged();
      else router.refresh();
    });
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary p-0.5"
    >
      {(["ltr", "str"] as const).map((s) => (
        <button
          key={s}
          type="button"
          disabled={busy}
          onClick={() => choose(s)}
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 " +
            (current === s ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-primary")
          }
        >
          {s}
        </button>
      ))}
      {busy && <span className="px-1 text-[10px] text-muted-foreground">re-underwriting…</span>}
    </div>
  );
}

const STATUS_LEFT_BORDER: Record<string, string> = {
  pending: "#f59e0b",
  active:  "#3b82f6",
  closed:  "#22c55e",
  dead:    "#ef4444",
  passed:  "#ef4444",
};

function DealCard({ deal, onOpen, onDeleted }: { deal: Deal; onOpen: () => void; onDeleted: (id: string) => void }) {
  const spread = equitySpread(deal);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const locality = [deal.city, deal.state].filter(Boolean).join(", ");
  const leftBorder = deal.status === "active" && deal.escrow_date
    ? "#3b82f6"
    : STATUS_LEFT_BORDER[deal.status] ?? "rgba(201,168,76,0.08)";

  return (
    <motion.div
      onClick={onOpen}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="glass-card flex cursor-pointer flex-col p-5 text-left"
      style={{ borderLeft: `3px solid ${leftBorder}` }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base text-white">{deal.property_address}</h3>
          {locality && <p className="truncate text-xs text-white/45">{locality}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {deal.next_milestone_days != null && deal.next_milestone_days <= 10 && (
            <span
              title={`Milestone in ${deal.next_milestone_days}d`}
              className="text-rose-600"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                <path d="M12 7.5v5l3 1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
          )}
          <StructureBadge structure={deal.structure_type} />
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={deal.status} />
          {deal.status === "closed" ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-inset ring-emerald-500/30">
              Closed
            </span>
          ) : deal.escrow_date ? (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent ring-1 ring-inset ring-accent/40">
              In Escrow
            </span>
          ) : null}
        </div>
        {deal.acquisition_grade == null && deal.stabilization_grade == null ? (
          <PendingGradeBadge />
        ) : (
          <div className="flex items-center gap-2.5">
            <GradeBadge
              caption="Acq"
              value={deal.acquisition_grade ?? 0}
              dim={(deal.acquisition_grade == null || deal.acquisition_grade === 0) && deal.cashback_at_close == null}
            />
            <GradeBadge
              caption="Stab"
              value={deal.stabilization_grade ?? 0}
              dim={(deal.stabilization_grade == null || deal.stabilization_grade === 0) && deal.cashback_at_close == null}
            />
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-white/40">Rental</span>
        <RentalToggle deal={deal} />
      </div>

      <dl className="grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
        <Metric label="Purchase" value={moneyCompact(deal.purchase_price)} />
        <Metric label="ARV" value={moneyCompact(deal.arv)} />
        <Metric label="Equity Spread" value={moneyCompact(spread)} accent />
      </dl>

      {(deal.status === "pending" || (deal.status === "active" && deal.escrow_date)) && (
        <CardCashback deal={deal} escrow={deal.status === "active" && !!deal.escrow_date} />
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-white/40">
        {deal.status === "dead" && deadDaysRemaining(deal) != null ? (
          <span className="font-medium text-rose-600">
            Auto-deletes in {deadDaysRemaining(deal)}d
          </span>
        ) : (
          <span>
            {deal.kp_count} {deal.kp_count === 1 ? "KP" : "KPs"}
          </span>
        )}
        <div className="flex items-center gap-2">
          <span>{updatedLabel(daysSince(deal.updated_at))}</span>
          {deal.status === "dead" && !confirmDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="rounded px-1.5 py-0.5 text-[11px] text-rose-500/70 hover:bg-rose-500/10 hover:text-rose-500"
            >
              Delete
            </button>
          )}
          {deal.status === "dead" && confirmDelete && (
            <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <span className="text-[11px] text-rose-600">Permanently delete?</span>
              <button
                type="button"
                disabled={deleting}
                onClick={async (e) => {
                  e.stopPropagation();
                  setDeleting(true);
                  const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
                  if (res.ok) {
                    onDeleted(deal.id);
                  } else {
                    setDeleting(false);
                    setConfirmDelete(false);
                  }
                }}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
              >
                {deleting ? "…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="rounded px-1.5 py-0.5 text-[11px] text-white/40 hover:bg-white/10"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Cashback + projected-fee block on pending/escrow pipeline cards. Cashback is
 * inline-editable and saved on blur via PATCH /api/deals/escrow. Interactive
 * area stops propagation so editing doesn't open the deal panel.
 */
function CardCashback({ deal, escrow }: { deal: Deal; escrow: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [editValue, setEditValue] = useState<string | null>(null);

  // Live waterfall from current deal fields — always agrees with the Overview tab.
  const liveWaterfall = deal.purchase_price != null
    ? calculateMorbyWaterfall({
        purchase_price: deal.purchase_price,
        ltv_percent: deal.ltv_percent,
        seller_note_amount: deal.seller_note_amount,
        assignment_fee: deal.assignment_fee,
        realtor_commission: deal.realtor_commission,
        insurance_annual: deal.insurance_annual,
        taxes_annual: deal.taxes_annual,
        tc_fee: deal.tc_fee,
        attorney_fee: deal.attorney_fee,
        pm_fee: deal.pm_fee,
      })
    : null;

  // Display priority: user is editing > live waterfall > stored DB fallback
  const idleValue = liveWaterfall != null
    ? String(Math.round(liveWaterfall.netToBuyer))
    : deal.cashback_at_close != null
    ? String(deal.cashback_at_close)
    : "";
  const cbStr = editValue ?? idleValue;
  const cbNum = cbStr === "" ? null : Number(cbStr);
  const cbPct = liveWaterfall != null
    ? liveWaterfall.cashbackPct
    : cbNum != null && deal.purchase_price
    ? (cbNum / deal.purchase_price) * 100
    : null;
  const aiFee = liveWaterfall != null
    ? liveWaterfall.portfolioAIFee
    : portfolioAiFee({ cashback_at_close: cbNum, purchase_price: deal.purchase_price });

  function save() {
    if (editValue === null) return;
    const num = editValue === "" ? null : Number(editValue);
    start(async () => {
      await fetch("/api/deals/escrow", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id, cashback_at_close: num }),
      });
      setEditValue(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-4" onClick={(e) => e.stopPropagation()}>
      {escrow && deal.escrow_date && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/45">Days in escrow</span>
          <span className="data-number tabular-nums text-white">{daysSince(deal.escrow_date)}d</span>
        </div>
      )}
      <div className="flex items-center justify-between text-xs">
        <span className="label-sub">Portfolio AI Fee</span>
        <span className="num-deal">{aiFee != null ? money(aiFee) : "—"}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="label-sub">Est. Net to Buyer</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
            <span className="text-white/40">$</span>
            <input
              type="number"
              value={cbStr}
              disabled={busy}
              onFocus={() => setEditValue(idleValue)}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={save}
              placeholder="—"
              className="w-20 bg-transparent px-1 text-right text-xs text-white outline-none"
            />
          </div>
          {cbPct != null && (
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
              style={{ background: "rgba(201,168,76,0.12)", color: "#C9A84C" }}
            >
              {cbPct.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="label-eyebrow mb-1">{label}</dt>
      <dd className="num-deal mt-1">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel (4 tabs)
// ---------------------------------------------------------------------------

const TABS = ["Overview", "AI Underwriting", "Timeline", "Documents", "KPs", "Activity"] as const;
type Tab = (typeof TABS)[number];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DealPanel({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  const router = useRouter();
  const open = deal !== null;
  const [tab, setTab] = useState<Tab>("Overview");
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [running, startRun] = useTransition();
  const [markingDead, startMarkDead] = useTransition();
  const [confirmingDead, setConfirmingDead] = useState(false);
  const [deadReason, setDeadReason] = useState(DEAD_REASONS[0]);
  const [intentionalPass, setIntentionalPass] = useState(false);
  const [markingClosed, startMarkClosed] = useTransition();
  const [confirmingClosed, setConfirmingClosed] = useState(false);

  const reloadDetail = () => {
    if (deal) getDealDetail(deal.id).then(setDetail);
  };
  const onChanged = () => {
    router.refresh();
    reloadDetail();
  };

  // Reset to Overview when a different deal opens.
  useEffect(() => {
    if (open) {
      setTab("Overview");
      setConfirmingDead(false);
      setConfirmingClosed(false);
    }
  }, [deal?.id, open]);

  // Load activity + documents for the open deal.
  useEffect(() => {
    if (!deal) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    getDealDetail(deal.id)
      .then((d) => !cancelled && setDetail(d))
      .finally(() => !cancelled && setLoadingDetail(false));
    return () => {
      cancelled = true;
    };
  }, [deal?.id, deal]);

  function onRun() {
    if (!deal) return;
    startRun(async () => {
      await runUnderwriting(deal.id);
      router.refresh();
      const d = await getDealDetail(deal.id);
      setDetail(d);
    });
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      direction="right"
    >
      <Drawer.Portal>
        <Drawer.Overlay
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 39,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
          }}
        />
        <Drawer.Content
          aria-label={deal ? `Deal detail: ${deal.property_address}` : "Deal detail"}
          className="fixed right-0 top-0 flex h-full w-full flex-col md:max-w-lg"
          style={{ background: "#ffffff", zIndex: 40, outline: "none", boxShadow: "-8px 0 40px rgba(0,0,0,0.4)" }}
        >
          {deal && (
            <>
              <div className="flex items-start justify-between gap-4 bg-primary px-6 py-5 text-primary-foreground">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    <StructureBadge structure={deal.structure_type} dark />
                    <StatusBadge status={deal.status} />
                  </div>
                  <h2 className="truncate text-xl text-primary-foreground">
                    {deal.property_address}
                  </h2>
                  {[deal.city, deal.state].filter(Boolean).length > 0 && (
                    <p className="text-sm text-primary-foreground/70">
                      {[deal.city, deal.state].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {deal.status !== "dead" && deal.status !== "closed" && deal.status !== "passed" && (
                    <button
                      type="button"
                      onClick={() => setConfirmingClosed(true)}
                      className="rounded-full border border-emerald-400/40 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
                    >
                      Mark Closed
                    </button>
                  )}
                  {deal.status !== "dead" && deal.status !== "closed" && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDead(true)}
                      className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-medium text-primary-foreground/80 transition-colors hover:bg-white/10"
                    >
                      Mark Dead
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="rounded-md p-1 text-primary-foreground/70 transition-colors hover:bg-white/10 hover:text-primary-foreground"
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              {confirmingDead && (
                <div className="flex flex-col gap-2 border-b border-border bg-secondary px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">Reason</span>
                    <select
                      value={deadReason}
                      onChange={(e) => setDeadReason(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-accent focus:outline-none"
                    >
                      {DEAD_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={markingDead}
                      onClick={() =>
                        startMarkDead(async () => {
                          await Promise.all([
                            markDealDead(deal.id, deadReason, intentionalPass),
                            new Promise<void>((r) => setTimeout(r, 350)),
                          ]);
                          setConfirmingDead(false);
                          setIntentionalPass(false);
                          router.refresh();
                          toast.success("Deal marked as dead");
                        })
                      }
                      className="shrink-0 rounded-full bg-destructive/90 px-3 py-1 text-xs font-medium text-white hover:bg-destructive disabled:opacity-60"
                    >
                      {markingDead ? "…" : "Confirm Dead"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDead(false)}
                      className="shrink-0 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={intentionalPass}
                      onChange={(e) => setIntentionalPass(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#c9a84c]"
                    />
                    Intentional Pass — outside buybox, exclude from close rate
                  </label>
                </div>
              )}

              {confirmingClosed && (
                <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2">
                  <span className="text-xs text-muted-foreground">Mark this deal as closed?</span>
                  <button
                    type="button"
                    disabled={markingClosed}
                    onClick={() =>
                      startMarkClosed(async () => {
                        const [result] = await Promise.all([
                          markDealClosed(deal.id),
                          new Promise<void>((r) => setTimeout(r, 350)),
                        ]);
                        if (result.ok) {
                          setConfirmingClosed(false);
                          const msg = result.holdingCreated
                            ? "Deal closed and added to Portfolio"
                            : "Deal marked as closed";
                          toast.success(msg);
                          router.refresh();
                        } else {
                          toast.error(result.error ?? "Failed to close deal");
                        }
                      })
                    }
                    className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {markingClosed ? "…" : "Confirm Closed"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClosed(false)}
                    className="shrink-0 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Tabs */}
              <div className="flex px-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className="-mb-px inline-flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors"
                    style={{
                      borderBottom: tab === t ? "2px solid #C9A84C" : "2px solid transparent",
                      color: tab === t ? "#ffffff" : "#52525b",
                    }}
                  >
                    {t}
                    {t === "AI Underwriting" && running && (
                      <span className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "#C9A84C" }} />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={tab}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                    className="px-6 py-6"
                  >
                    {tab === "Overview" && (
                      <OverviewTab
                        deal={deal}
                        onChanged={onChanged}
                        onReunderwrite={onRun}
                        reunderwriting={running}
                      />
                    )}
                    {tab === "AI Underwriting" && (
                      <AiTab deal={deal} running={running} onRun={onRun} />
                    )}
                    {tab === "Timeline" && (
                      <TimelineTab
                        dealId={deal.id}
                        milestones={detail?.milestones ?? []}
                        loading={loadingDetail}
                        onChanged={onChanged}
                      />
                    )}
                    {tab === "Documents" && (
                      <DocumentsTab
                        dealId={deal.id}
                        loading={loadingDetail}
                        detail={detail}
                        onChanged={onChanged}
                      />
                    )}
                    {tab === "KPs" && <KpsTab dealId={deal.id} onChanged={onChanged} />}
                    {tab === "Activity" && (
                      <ActivityTab loading={loadingDetail} detail={detail} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// Fields that auto-trigger re-underwrite when saved from the Overview tab.
const REUNDERWRITE_ON_SAVE = new Set([
  "purchase_price", "arv", "seller_note_amount", "ltv_percent", "assignment_fee", "realtor_commission",
]);

function OverviewTab({
  deal,
  onChanged,
  onReunderwrite,
}: {
  deal: Deal;
  onChanged: () => void;
  onReunderwrite: () => void;
  reunderwriting: boolean;
}) {
  const ed = deal.ai_analysis?.extracted_deal_data;
  const assetType = ed?.property_type ?? "—";

  // Live state for real-time waterfall preview
  const [livePp, setLivePp] = useState<number | null>(deal.purchase_price);
  const [liveSellerCarry, setLiveSellerCarry] = useState<number | null>(deal.seller_note_amount);
  const [liveLtv, setLiveLtv] = useState<number>(deal.ltv_percent ?? 75);
  const [liveAssignFee, setLiveAssignFee] = useState<number>(deal.assignment_fee ?? 0);
  const [liveRealtor, setLiveRealtor] = useState<number | null>(deal.realtor_commission ?? null);
  const [liveInsurance, setLiveInsurance] = useState<number | null>(deal.insurance_annual ?? null);
  const [liveTaxes, setLiveTaxes] = useState<number | null>(deal.taxes_annual ?? null);
  const [liveTcFee, setLiveTcFee] = useState<number>(deal.tc_fee ?? 0);
  const [liveAttorneyFee, setLiveAttorneyFee] = useState<number>(deal.attorney_fee ?? 0);
  const [livePmFee, setLivePmFee] = useState<number>(deal.pm_fee ?? 0);

  // Reset live state when a different deal is opened
  useEffect(() => {
    setLivePp(deal.purchase_price);
    setLiveSellerCarry(deal.seller_note_amount);
    setLiveLtv(deal.ltv_percent ?? 75);
    setLiveAssignFee(deal.assignment_fee ?? 0);
    setLiveRealtor(deal.realtor_commission ?? null);
    setLiveInsurance(deal.insurance_annual ?? null);
    setLiveTaxes(deal.taxes_annual ?? null);
    setLiveTcFee(deal.tc_fee ?? 0);
    setLiveAttorneyFee(deal.attorney_fee ?? 0);
    setLivePmFee(deal.pm_fee ?? 0);
  }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function makeOnSaved(field: string) {
    return () => {
      onChanged();
      if (REUNDERWRITE_ON_SAVE.has(field)) onReunderwrite();
    };
  }

  // Real-time Morby waterfall using pure deterministic function
  const liveWaterfall = livePp != null
    ? calculateMorbyWaterfall({
        purchase_price: livePp,
        ltv_percent: liveLtv,
        seller_note_amount: liveSellerCarry,
        assignment_fee: liveAssignFee,
        realtor_commission: liveRealtor,
        insurance_annual: liveInsurance,
        taxes_annual: liveTaxes,
        tc_fee: liveTcFee,
        attorney_fee: liveAttorneyFee,
        pm_fee: livePmFee,
      })
    : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Rental Strategy
        </span>
        <RentalToggle deal={deal} onChanged={onChanged} />
      </div>

      <Section title="Overview · click a value to edit">
        <EditableRow dealId={deal.id} field="property_address" label="Address" raw={deal.property_address} display={deal.property_address} onSaved={makeOnSaved("property_address")} />
        <EditableRow dealId={deal.id} field="wholesaler_name" label="Wholesaler" raw={deal.wholesaler_name ?? null} display={deal.wholesaler_name ?? "—"} onSaved={makeOnSaved("wholesaler_name")} />
        <Row label="Asset Type" value={assetType} mono={false} />
        <EditableRow
          dealId={deal.id} field="purchase_price" label="Purchase Price" numeric
          raw={deal.purchase_price} display={money(deal.purchase_price)}
          onSaved={makeOnSaved("purchase_price")}
          onLiveChange={(v) => setLivePp(v === "" ? null : Number(v))}
        />
        <EditableRow dealId={deal.id} field="arv" label="ARV" numeric raw={deal.arv} display={money(deal.arv)} onSaved={makeOnSaved("arv")} />
        <LtvRow
          dealId={deal.id}
          ltvPct={liveLtv}
          purchasePrice={livePp}
          onSaved={makeOnSaved("ltv_percent")}
          onLiveChange={(ltv) => setLiveLtv(ltv)}
        />
        <EditableRow
          dealId={deal.id} field="seller_note_amount" label="Seller Note Balance" numeric
          raw={deal.seller_note_amount} display={money(deal.seller_note_amount)}
          onSaved={makeOnSaved("seller_note_amount")}
          onLiveChange={(v) => setLiveSellerCarry(v === "" ? null : Number(v))}
        />
        {liveWaterfall != null && (
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <dt className="shrink-0 text-sm text-muted-foreground">DPTS — Cash to Seller</dt>
            <dd className="data-number text-right text-sm font-medium tabular-nums text-[#D4AF37]">
              {money(liveWaterfall.dpts)}
            </dd>
          </div>
        )}
        <EditableRow
          dealId={deal.id} field="assignment_fee" label="Assignment Fee" numeric
          raw={deal.assignment_fee} display={money(deal.assignment_fee)}
          onSaved={makeOnSaved("assignment_fee")}
          onLiveChange={(v) => setLiveAssignFee(v === "" ? 0 : Number(v))}
        />
        <EditableRow dealId={deal.id} field="total_cash_invested" label="Cash Invested" numeric ai raw={ed?.total_cash_invested ?? null} display={money(ed?.total_cash_invested ?? null)} onSaved={makeOnSaved("total_cash_invested")} />
        <EditableRow dealId={deal.id} field="net_monthly_cashflow" label="Net Monthly" numeric ai raw={ed?.net_monthly_cashflow ?? null} display={money(ed?.net_monthly_cashflow ?? null)} onSaved={makeOnSaved("net_monthly_cashflow")} />
        <EditableRow dealId={deal.id} field="annual_gross_revenue" label="Annual Revenue" numeric ai raw={ed?.annual_gross_revenue ?? null} display={money(ed?.annual_gross_revenue ?? null)} onSaved={makeOnSaved("annual_gross_revenue")} />
        <Row label="Equity Spread" value={money(equitySpread(deal))} />
        <Row label="ACQ Grade" value={deal.acquisition_grade != null ? `${deal.acquisition_grade} / 100` : "—"} />
        <Row label="STAB Grade" value={deal.stabilization_grade != null ? `${deal.stabilization_grade} / 100` : "—"} />
        <Row label="Capital Runway Multiple" value={capitalRunwayMultiple(deal)} />
        {liveWaterfall != null && (
          <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2.5">
            <dt className="shrink-0 text-sm text-muted-foreground">Est. Net to Buyer</dt>
            <dd className={`data-number text-right text-sm font-bold tabular-nums ${liveWaterfall.netToBuyer >= 0 ? "text-[#D4AF37]" : "text-rose-500"}`}>
              {money(liveWaterfall.netToBuyer)}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">({liveWaterfall.cashbackPct.toFixed(1)}%)</span>
            </dd>
          </div>
        )}
      </Section>

      <Section title="Cost Inputs · click to edit">
        <EditableRow
          dealId={deal.id} field="realtor_commission" label="Realtor Commission" numeric
          raw={deal.realtor_commission ?? null} display={money(deal.realtor_commission)}
          onSaved={makeOnSaved("realtor_commission")}
          onLiveChange={(v) => setLiveRealtor(v === "" ? null : Number(v))}
        />
        <EditableRow
          dealId={deal.id} field="insurance_annual" label="Insurance / yr" numeric
          raw={deal.insurance_annual ?? null} display={money(deal.insurance_annual)}
          onSaved={makeOnSaved("insurance_annual")}
          onLiveChange={(v) => setLiveInsurance(v === "" ? null : Number(v))}
        />
        <EditableRow
          dealId={deal.id} field="taxes_annual" label="Taxes / yr" numeric
          raw={deal.taxes_annual ?? null} display={money(deal.taxes_annual)}
          onSaved={makeOnSaved("taxes_annual")}
          onLiveChange={(v) => setLiveTaxes(v === "" ? null : Number(v))}
        />
        <EditableRow
          dealId={deal.id} field="hoa_monthly" label="HOA / mo" numeric
          raw={deal.hoa_monthly ?? null} display={money(deal.hoa_monthly)}
          onSaved={makeOnSaved("hoa_monthly")}
        />
        <EditableRow
          dealId={deal.id} field="first_lien_monthly" label="First Lien / mo" numeric
          raw={deal.first_lien_monthly ?? null} display={money(deal.first_lien_monthly)}
          onSaved={makeOnSaved("first_lien_monthly")}
        />
        <EditableRow
          dealId={deal.id} field="seller_carry_monthly" label="Seller Carry / mo" numeric
          raw={deal.seller_carry_monthly ?? null} display={money(deal.seller_carry_monthly)}
          onSaved={makeOnSaved("seller_carry_monthly")}
        />
        <EditableRow
          dealId={deal.id} field="tc_fee" label="TC Fee" numeric
          raw={deal.tc_fee ?? null} display={money(deal.tc_fee)}
          onSaved={makeOnSaved("tc_fee")}
          onLiveChange={(v) => setLiveTcFee(v === "" ? 0 : Number(v))}
        />
        <EditableRow
          dealId={deal.id} field="attorney_fee" label="Attorney Fee" numeric
          raw={deal.attorney_fee ?? null} display={money(deal.attorney_fee)}
          onSaved={makeOnSaved("attorney_fee")}
          onLiveChange={(v) => setLiveAttorneyFee(v === "" ? 0 : Number(v))}
        />
        <EditableRow
          dealId={deal.id} field="pm_fee" label="PM Fee" numeric
          raw={deal.pm_fee ?? null} display={money(deal.pm_fee)}
          onSaved={makeOnSaved("pm_fee")}
          onLiveChange={(v) => setLivePmFee(v === "" ? 0 : Number(v))}
        />
      </Section>

      <WholesalerActions deal={deal} onChanged={onChanged} />
      <EscrowAction deal={deal} onChanged={onChanged} />
    </div>
  );
}

/**
 * Move an active deal into the escrow pipeline. Shown only for active deals;
 * once escrow_date is set it shows an "In Escrow" indicator instead.
 */
function EscrowAction({ deal, onChanged }: { deal: Deal; onChanged: () => void }) {
  const [busy, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (deal.status !== "active") return null;

  function move() {
    setError("");
    start(async () => {
      const res = await fetch("/api/deals/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Could not move the deal to escrow.");
        return;
      }
      setDone(true);
      onChanged();
      setTimeout(() => setDone(false), 4000);
    });
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Escrow
      </p>
      {deal.escrow_date ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          In Escrow since {new Date(deal.escrow_date).toLocaleDateString("en-US")}
        </span>
      ) : (
        <button
          type="button"
          onClick={move}
          disabled={busy}
          className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {busy ? "Moving…" : "Move to Escrow"}
        </button>
      )}
      {done && <p className="mt-2 text-xs font-medium text-emerald-600">Deal moved to Escrow Pipeline</p>}
      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
    </div>
  );
}

/**
 * Wholesaler response actions for a pending deal: Accept / Negotiate / Reject.
 * Each emails the submitter and logs to deal_activity (server-side). Negotiate
 * reveals an inline textarea for John's message.
 */
function WholesalerActions({
  deal,
  onChanged,
}: {
  deal: Deal;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [negotiating, setNegotiating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (deal.status !== "pending") return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void, successMsg?: string) {
    setError("");
    start(async () => {
      const [res] = await Promise.all([fn(), new Promise<void>((r) => setTimeout(r, 350))]);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        toast.error(res.error ?? "Something went wrong.");
        return;
      }
      after?.();
      onChanged();
      if (successMsg) toast.success(successMsg);
    });
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Respond to wholesaler
      </p>

      {negotiating ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Your message to the wholesaler — what you'd like to discuss…"
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !message.trim()}
              onClick={() =>
                run(
                  () => negotiateDeal(deal.id, message),
                  () => {
                    setNegotiating(false);
                    setMessage("");
                  },
                  "Message sent",
                )
              }
              className="flex-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send Message"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setNegotiating(false);
                setError("");
              }}
              className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => acceptDeal(deal.id), undefined, "Deal accepted")}
            className="flex-1 rounded-full bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError("");
              setNegotiating(true);
            }}
            className="flex-1 rounded-full border border-border px-3 py-2 text-xs font-medium text-primary hover:bg-secondary disabled:opacity-60"
          >
            Negotiate
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => rejectDeal(deal.id), undefined, "Deal rejected")}
            className="flex-1 rounded-full bg-destructive/90 px-3 py-2 text-xs font-medium text-white hover:bg-destructive disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
    </div>
  );
}

function EditableRow({
  dealId,
  field,
  label,
  raw,
  display,
  numeric,
  ai,
  onSaved,
  onLiveChange,
}: {
  dealId: string;
  field: string;
  label: string;
  raw: string | number | null;
  display: string;
  numeric?: boolean;
  ai?: boolean;
  onSaved: () => void;
  onLiveChange?: (value: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(raw == null ? "" : String(raw));
  const [saving, startSave] = useTransition();

  function save() {
    startSave(async () => {
      const res = ai
        ? await updateDealAiField(dealId, field, value)
        : await updateDealField(dealId, field, value);
      if (res.ok) {
        setEditing(false);
        onSaved();
        // Waterfall write-back happened server-side; force a second refresh so
        // the card picks up the new cashback_at_close from the DB.
        if (!ai && res.waterfallUpdated) router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type={numeric ? "number" : "text"}
            value={value}
            onChange={(e) => { setValue(e.target.value); onLiveChange?.(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-36 rounded-md border border-border bg-secondary px-2 py-1 text-right text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground disabled:opacity-60"
          >
            {saving ? "…" : "Save"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setValue(raw == null ? "" : String(raw));
            setEditing(true);
          }}
          className="data-number truncate rounded text-right text-sm font-medium text-primary hover:bg-secondary hover:px-1"
          title="Click to edit"
        >
          {display}
        </button>
      )}
    </div>
  );
}

/** LTV % row: editable percentage with auto-calculated loan amount displayed below. */
function LtvRow({
  dealId,
  ltvPct,
  purchasePrice,
  onSaved,
  onLiveChange,
}: {
  dealId: string;
  ltvPct: number;
  purchasePrice: number | null;
  onSaved: () => void;
  onLiveChange: (ltv: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(ltvPct));
  const [saving, startSave] = useTransition();

  const ltvNum = Number(value) || 75;
  const calcLoan = purchasePrice != null ? purchasePrice * (ltvNum / 100) : null;

  function save() {
    startSave(async () => {
      const res = await updateDealField(dealId, "ltv_percent", value);
      if (res.ok) {
        // Keep loan_amount in sync so re-underwrite has correct data
        if (purchasePrice != null) {
          await updateDealField(dealId, "loan_amount", String(calcLoan));
        }
        setEditing(false);
        onSaved();
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">LTV %</dt>
      <div className="flex flex-col items-end gap-0.5">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="number"
              value={value}
              min="0"
              max="100"
              step="any"
              onChange={(e) => {
                setValue(e.target.value);
                onLiveChange(Number(e.target.value) || 75);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-20 rounded-md border border-border bg-secondary px-2 py-1 text-right text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="text-sm text-muted-foreground">%</span>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground disabled:opacity-60"
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setValue(String(ltvPct)); setEditing(true); }}
            className="data-number rounded text-right text-sm font-medium text-primary hover:bg-secondary hover:px-1"
            title="Click to edit LTV %"
          >
            {ltvPct}%
          </button>
        )}
        {calcLoan != null && (
          <span className="data-number text-[11px] text-muted-foreground tabular-nums">
            Loan: {money(calcLoan)}
          </span>
        )}
      </div>
    </div>
  );
}

function WaterfallBreakdown({ w, ltvPct }: { w: WaterfallResult; ltvPct: number }) {
  const neg = (v: number) => (
    <span className="data-number tabular-nums text-rose-500">–{money(v)}</span>
  );
  const netColor = w.netToBuyer >= 0 ? "text-[#D4AF37] font-bold" : "text-rose-500 font-bold";
  return (
    <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 text-xs">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Morby Waterfall
      </p>
      <div className="space-y-1 text-muted-foreground">
        <div className="flex justify-between">
          <span>DSCR Loan ({ltvPct}% LTV)</span>
          <span className="data-number tabular-nums text-foreground">{money(w.dscrLoan)}</span>
        </div>
        <div className="flex justify-between">
          <span>TL Fee (3.5% of gap)</span>
          {neg(w.tlFee)}
        </div>
        <div className="flex justify-between">
          <span>Closing Costs (2.5%)</span>
          {neg(w.closingCosts)}
        </div>
        <div className="flex justify-between">
          <span>Prepaid Insurance</span>
          {neg(w.prepaidInsurance)}
        </div>
        <div className="flex justify-between">
          <span>Prepaid Taxes</span>
          {neg(w.prepaidTaxes)}
        </div>
        {w.realtorCommission > 0 && (
          <div className="flex justify-between">
            <span>Realtor Commission</span>
            {neg(w.realtorCommission)}
          </div>
        )}
        <div className="flex justify-between">
          <span>DPTS — Cash to Seller</span>
          {neg(w.dpts)}
        </div>
        {w.assignmentFee > 0 && (
          <div className="flex justify-between">
            <span>Assignment Fee</span>
            {neg(w.assignmentFee)}
          </div>
        )}
        {w.tcFee > 0 && (
          <div className="flex justify-between">
            <span>TC Fee</span>
            {neg(w.tcFee)}
          </div>
        )}
        {w.attorneyFee > 0 && (
          <div className="flex justify-between">
            <span>Attorney Fee</span>
            {neg(w.attorneyFee)}
          </div>
        )}
        {w.pmFee > 0 && (
          <div className="flex justify-between">
            <span>PM Fee</span>
            {neg(w.pmFee)}
          </div>
        )}
        {w.creditPartnerFee > 0 && (
          <div className="flex justify-between">
            <span>Credit Partner (5%)</span>
            {neg(w.creditPartnerFee)}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between border-t border-border pt-2">
        <span className="font-semibold text-foreground">NET TO BUYER</span>
        <span>
          <span className={`data-number tabular-nums ${netColor}`}>{money(w.netToBuyer)}</span>
          <span className="ml-1.5 font-normal text-muted-foreground">({w.cashbackPct.toFixed(1)}%)</span>
        </span>
      </div>
      {w.portfolioAIFee > 0 && (
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>Portfolio AI Fee (10%)</span>
          <span className="data-number tabular-nums">{money(w.portfolioAIFee)}</span>
        </div>
      )}
    </div>
  );
}

function CashflowBreakdown({ c }: { c: CashflowResult }) {
  const neg = (v: number) => (
    <span className="data-number tabular-nums text-rose-500">–{money(v)}</span>
  );
  const cashColor = c.monthlyCashflow >= 0 ? "text-emerald-400 font-bold" : "text-rose-500 font-bold";
  return (
    <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 text-xs">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Cashflow Analysis
      </p>
      <div className="space-y-1 text-muted-foreground">
        <div className="flex justify-between">
          <span>Gross Annual Rent</span>
          <span className="data-number tabular-nums text-foreground">{money(c.grossAnnualRent)}</span>
        </div>
        <div className="flex justify-between">
          <span>Vacancy (8%)</span>
          {neg(c.vacancy)}
        </div>
        <div className="flex justify-between">
          <span>CapEx (20%)</span>
          {neg(c.capex)}
        </div>
        <div className="flex justify-between">
          <span>Management (8%)</span>
          {neg(c.management)}
        </div>
        <div className="flex justify-between">
          <span>Insurance</span>
          {neg(c.insurance)}
        </div>
        <div className="flex justify-between">
          <span>Taxes</span>
          {neg(c.taxes)}
        </div>
        {c.hoa > 0 && (
          <div className="flex justify-between">
            <span>HOA</span>
            {neg(c.hoa)}
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1">
          <span className="text-foreground">NOI</span>
          <span className={`data-number tabular-nums ${c.noi >= 0 ? "text-foreground" : "text-rose-500"}`}>{money(c.noi)}</span>
        </div>
        {c.annualDebtService > 0 && (
          <div className="flex justify-between">
            <span>Annual Debt Service</span>
            {neg(c.annualDebtService)}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between border-t border-border pt-2">
        <span className="font-semibold text-foreground">Monthly Cashflow</span>
        <span className={`data-number tabular-nums ${cashColor}`}>{money(c.monthlyCashflow)}</span>
      </div>
      {c.dscr != null && (
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>DSCR</span>
          <span className={`data-number tabular-nums ${c.dscr >= 1 ? "text-emerald-400" : "text-rose-500"}`}>{c.dscr.toFixed(2)}x</span>
        </div>
      )}
    </div>
  );
}

function AiTab({
  deal,
  running,
  onRun,
}: {
  deal: Deal;
  running: boolean;
  onRun: () => void;
}) {
  const uw = deal.ai_analysis?.underwriting ?? null;
  // Always recompute from current deal fields so the display matches Overview
  // and picks up tc_fee/attorney_fee/pm_fee and any edits since last underwrite.
  const waterfall = deal.purchase_price != null
    ? calculateMorbyWaterfall({
        purchase_price: deal.purchase_price,
        ltv_percent: deal.ltv_percent,
        seller_note_amount: deal.seller_note_amount,
        assignment_fee: deal.assignment_fee,
        realtor_commission: deal.realtor_commission,
        insurance_annual: deal.insurance_annual,
        taxes_annual: deal.taxes_annual,
        tc_fee: deal.tc_fee,
        attorney_fee: deal.attorney_fee,
        pm_fee: deal.pm_fee,
      })
    : null;
  const cashflow = deal.ai_analysis?.cashflow ?? null;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          AI Underwriting
        </span>
        <button
          type="button"
          disabled={running}
          onClick={onRun}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {running ? "Running…" : uw ? "Re-run" : "Run underwriting"}
        </button>
      </div>

      {!uw ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Not yet underwritten. Run the engine on this deal.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-primary p-4 text-primary-foreground">
            <div className="text-[10px] font-medium uppercase tracking-widest text-primary-foreground/60">
              Deal Tier
            </div>
            <div className="mt-1 text-lg font-medium">{uw.deal_tier ?? "—"}</div>
            <div className="mt-2 flex gap-6 text-sm">
              <span className="data-number">ACQ {uw.acquisition_grade} · {uw.acquisition_score}</span>
              <span className="data-number">STAB {uw.stabilization_grade} · {uw.stabilization_score}</span>
            </div>
          </div>

          {waterfall != null
            ? <WaterfallBreakdown w={waterfall} ltvPct={deal.ltv_percent ?? 75} />
            : uw.cashback_amount != null && (
              <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 text-xs">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Net to Buyer</p>
                <div className="flex justify-between">
                  <span className="font-semibold text-foreground">NET TO BUYER</span>
                  <span className="data-number font-bold tabular-nums text-[#D4AF37]">
                    {money(uw.cashback_amount)}
                    {uw.cashback_pct != null && <span className="ml-1.5 font-normal text-muted-foreground">({uw.cashback_pct.toFixed(1)}%)</span>}
                  </span>
                </div>
              </div>
            )
          }

          {cashflow != null && <CashflowBreakdown c={cashflow} />}

          <div className="grid grid-cols-2 gap-3">
            <AiStat label="Total Oblig. / mo" value={money(uw.total_obligations ?? null)} />
            <AiStat label="First Lien / mo" value={money(uw.first_lien_payment ?? null)} />
            <AiStat label="Seller Carry / mo" value={money(uw.seller_carry_payment ?? null)} />
            <AiStat label="Current Coverage" value={uw.current_coverage_pct != null ? `${uw.current_coverage_pct.toFixed(0)}%` : "—"} />
            <AiStat label="Proj. Coverage" value={uw.projected_coverage_pct != null ? `${uw.projected_coverage_pct.toFixed(0)}%` : "—"} />
            <AiStat label="Current Rent" value={money(uw.current_rent ?? null)} />
            <AiStat label="Rent Source" value={uw.rent_source ?? "—"} />
          </div>
          <p className="text-sm leading-relaxed text-foreground">{uw.ai_summary ?? uw.summary}</p>
          <BulletBlock title="Important Flags" items={uw.important_flags ?? []} />
        </div>
      )}
    </div>
  );
}

function AiStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="data-number mt-0.5 text-sm tabular-nums text-primary">{value}</div>
    </div>
  );
}

function BulletBlock({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground">
            <span className="text-accent">·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApplyButton({
  label,
  onApply,
}: {
  label: string;
  onApply: () => Promise<{ ok: boolean }>;
}) {
  const [busy, start] = useTransition();
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs font-medium text-emerald-600">Applied</span>;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => start(async () => { const r = await onApply(); if (r.ok) setDone(true); })}
      className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
    >
      {busy ? "…" : label}
    </button>
  );
}

function DocumentsTab({
  dealId,
  loading,
  detail,
  onChanged,
}: {
  dealId: string;
  loading: boolean;
  detail: DealDetail | null;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docs = detail?.documents ?? [];

  function handleFile(f: File) {
    const fd = new FormData();
    fd.append("file", f);
    setError(null);
    startUpload(async () => {
      const res = await uploadDealDocument(dealId, fd);
      if (!res.ok) {
        setError(res.error);
        onChanged();
        return;
      }
      setExtraction(res.extraction);
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    });
  }

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
          dragOver
            ? "border-[#D4AF37] bg-[#D4AF37]/5"
            : "border-white/20 bg-[#1a1f2e] hover:border-white/40"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <span className="text-sm text-gray-400">
          {uploading ? "Uploading…" : "Drop files here or click to upload"}
        </span>
        <span className="mt-1 text-xs text-gray-600">PDF or image — stored to deal documents</span>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {extraction && (
        <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Claude found — apply updates?
          </div>
          <p className="text-xs text-muted-foreground">{extraction.summary}</p>
          {extraction.milestones.map((m, i) => (
            <div key={`m${i}`} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">
                {m.label} · <span className="data-number">{m.target_date}</span>
              </span>
              <span className="shrink-0 text-xs font-medium text-emerald-600">
                Added to Timeline
              </span>
            </div>
          ))}
          {extraction.term_changes.map((t, i) => (
            <div key={`t${i}`} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">
                {t.label} → <span className="data-number">{String(t.suggested_value)}</span>
              </span>
              <ApplyButton
                label="Apply"
                onApply={async () => {
                  const r = await updateDealField(dealId, t.field, String(t.suggested_value ?? ""));
                  onChanged();
                  return r;
                }}
              />
            </div>
          ))}
          {extraction.milestones.length === 0 && extraction.term_changes.length === 0 && (
            <p className="text-xs text-muted-foreground">No dates or term changes detected.</p>
          )}
          <button
            type="button"
            onClick={() => setExtraction(null)}
            className="text-xs text-muted-foreground hover:text-primary"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No documents on file.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 px-3 py-3">
              <span className="truncate text-sm text-primary">{doc.file_name}</span>
              {doc.url ? (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/70"
                >
                  Download
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">Unavailable</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineTab({
  dealId,
  milestones,
  loading,
  onChanged,
}: {
  dealId: string;
  milestones: DealMilestone[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [adding, startAdd] = useTransition();
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState<MilestoneType>("custom");

  function add() {
    if (!label.trim() || !date) return;
    startAdd(async () => {
      const r = await createMilestone(dealId, { label, target_date: date, milestone_type: type });
      if (r.ok) {
        setLabel("");
        setDate("");
        setType("custom");
        onChanged();
      }
    });
  }

  function countdown(d: string) {
    const n = daysUntil(d);
    // green 7+, yellow 3-6, red under 3, gray expired
    const tone =
      n < 0
        ? "text-muted-foreground"
        : n < 3
          ? "text-rose-600"
          : n <= 6
            ? "text-amber-700"
            : "text-emerald-600";
    const txt = n === 0 ? "Today" : n < 0 ? `${-n}d ago` : `in ${n}d`;
    return <span className={"data-number text-sm font-medium " + tone}>{txt}</span>;
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : milestones.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No milestones yet. Add EMD, inspection, or COE dates below — or upload a contract in Documents to auto-extract them.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-primary">
                  {m.label}
                  {m.milestone_type && m.milestone_type !== "custom" && (
                    <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {MILESTONE_LABELS[m.milestone_type]}
                    </span>
                  )}
                  {m.source === "ai_extracted" && (
                    <span className="ml-1 text-[10px] text-accent">AI</span>
                  )}
                </div>
                <div className="data-number text-xs text-muted-foreground">{m.target_date}</div>
              </div>
              <div className="flex items-center gap-3">
                {countdown(m.target_date)}
                <button
                  type="button"
                  onClick={() => deleteMilestone(m.id, dealId).then(onChanged)}
                  aria-label="Delete milestone"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-border p-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Add milestone
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            className="col-span-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MilestoneType)}
            className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="emd">Earnest Money</option>
            <option value="inspection">Inspection Period</option>
            <option value="coe">Close of Escrow</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <button
          type="button"
          disabled={adding}
          onClick={add}
          className="mt-2 w-full rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {adding ? "Adding…" : "Add Milestone"}
        </button>
      </div>
    </div>
  );
}

const KP_STATUS_BADGE: Record<AssignmentStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  accepted: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  declined: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
};

function KpsTab({ dealId, onChanged }: { dealId: string; onChanged: () => void }) {
  const [assignments, setAssignments] = useState<KpAssignment[]>([]);
  const [available, setAvailable] = useState<AvailableKp[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();

  const reload = () => {
    setLoading(true);
    Promise.all([getDealKpAssignments(dealId), getAvailableKps(dealId)])
      .then(([a, av]) => {
        setAssignments(a);
        setAvailable(av);
        setSelected("");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getDealKpAssignments(dealId), getAvailableKps(dealId)]).then(
      ([a, av]) => {
        if (cancelled) return;
        setAssignments(a);
        setAvailable(av);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  function assign() {
    if (!selected) return;
    setError("");
    startBusy(async () => {
      const res = await assignKpToDeal(dealId, selected);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reload();
      onChanged();
    });
  }

  function remove(assignmentId: string) {
    startBusy(async () => {
      const res = await removeKpAssignment(assignmentId, dealId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reload();
      onChanged();
    });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-secondary/30 p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Assign a Key Principal
        </p>
        {available.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No more KPs available. Add KPs from the Key Principals page first.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            >
              <option value="">Select a KP…</option>
              {available.map((kp) => (
                <option key={kp.id} value={kp.id}>
                  {kp.full_name ?? kp.email ?? "Unnamed KP"}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selected || busy}
              onClick={assign}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      </div>

      {assignments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No KPs assigned to this deal yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-primary">
                  {a.kp_name ?? a.kp_email ?? "Unnamed KP"}
                </p>
                {a.kp_email && (
                  <p className="truncate text-xs text-muted-foreground">{a.kp_email}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${KP_STATUS_BADGE[a.status]}`}
                >
                  {ASSIGNMENT_STATUS_LABELS[a.status]}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(a.id)}
                  className="text-xs text-muted-foreground hover:text-rose-400 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityTab({
  loading,
  detail,
}: {
  loading: boolean;
  detail: DealDetail | null;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const items = detail?.activity ?? [];
  if (items.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No activity yet.
      </p>
    );
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="border-l-2 border-accent/40 pl-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-primary">
              {a.action.replace(/_/g, " ")}
            </span>
            <span className="data-number text-[11px] text-muted-foreground">
              {fmtDateTime(a.created_at)}
            </span>
          </div>
          {a.note && <p className="mt-0.5 text-sm text-muted-foreground">{a.note}</p>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Shared row / section
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className={"truncate text-right text-sm font-medium text-primary " + (mono ? "data-number tabular-nums" : "")}>
        {value}
      </dd>
    </div>
  );
}

function EmptyState({ hasDeals }: { hasDeals: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
      <p className="text-sm font-medium text-primary">
        {hasDeals ? "No deals match this filter" : "No deals yet"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {hasDeals
          ? "Try a different status or structure."
          : "Deals appear here once they're submitted or added."}
      </p>
    </div>
  );
}
