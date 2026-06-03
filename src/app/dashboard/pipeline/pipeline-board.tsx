"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  type Deal,
  type DealStatus,
  type DealStructure,
  RECOMMENDATION_LABELS,
  STATUS_LABELS,
  STRUCTURE_LABELS,
  capitalRunwayMultiple,
  daysSince,
  equitySpread,
} from "@/lib/types";
import { money, moneyCompact, updatedLabel } from "@/lib/format";
import {
  acceptDeal,
  passDeal,
  runUnderwriting,
  getDealDetail,
  createDeal,
  type DealDetail,
  type NewDealInput,
} from "./actions";

const ASSET_TYPES = ["Multifamily", "Commercial", "Mixed Use", "Industrial", "Land"];

const STATUS_TABS: { key: DealStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "passed", label: "Passed" },
];

export function PipelineBoard({ deals }: { deals: Deal[] }) {
  const [status, setStatus] = useState<DealStatus | "all">("all");
  const [structure, setStructure] = useState<DealStructure | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const structures = useMemo(
    () =>
      (Object.keys(STRUCTURE_LABELS) as DealStructure[]).filter((s) =>
        deals.some((d) => d.structure_type === s),
      ),
    [deals],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: deals.length };
    for (const d of deals) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [deals]);

  const filtered = useMemo(
    () =>
      deals.filter(
        (d) =>
          (status === "all" || d.status === status) &&
          (structure === "all" || d.structure_type === structure),
      ),
    [deals, status, structure],
  );

  const [adding, setAdding] = useState(false);

  const selected = deals.find((d) => d.id === selectedId) ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {/* Status tabs + Add Deal */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border">
        <div className="flex flex-wrap gap-1">
        {STATUS_TABS.map((t) => {
          const active = status === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors " +
                (active
                  ? "border-accent text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary")
              }
            >
              {t.label}
              <span className="ml-1.5 data-number text-xs text-muted-foreground">
                {counts[t.key] ?? 0}
              </span>
            </button>
          );
        })}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mb-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90"
        >
          + Add Deal
        </button>
      </div>

      {/* Structure chips */}
      {structures.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="w-20 shrink-0 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Structure
          </span>
          <Chip active={structure === "all"} onClick={() => setStructure("all")}>
            All
          </Chip>
          {structures.map((s) => (
            <Chip key={s} active={structure === s} onClick={() => setStructure(s)}>
              {STRUCTURE_LABELS[s]}
            </Chip>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState hasDeals={deals.length > 0} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onOpen={() => setSelectedId(deal.id)}
            />
          ))}
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
            <ModalField label="Seller carry" name="seller_carry" type="number" defaultValue="0" />
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
  const tone =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30"
      : status === "passed"
        ? "bg-rose-500/10 text-rose-600 ring-rose-400/20"
        : "bg-accent/15 text-amber-700 ring-accent/30";
  return (
    <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 " + tone}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function gradeClasses(v: number): string {
  if (v >= 80) return "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30";
  if (v >= 60) return "bg-accent/15 text-amber-700 ring-accent/40";
  return "bg-rose-500/10 text-rose-600 ring-rose-400/30";
}

function GradeBadge({ caption, value }: { caption: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={
          "data-number flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium tabular-nums ring-1 " +
          gradeClasses(value)
        }
      >
        {value}
      </span>
      <span className="text-[8px] font-medium uppercase tracking-widest text-muted-foreground">
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

function DealCard({ deal, onOpen }: { deal: Deal; onOpen: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [passing, setPassing] = useState(false);
  const [reason, setReason] = useState("");
  const spread = equitySpread(deal);
  const locality = [deal.city, deal.state].filter(Boolean).join(", ");

  function accept(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      await acceptDeal(deal.id);
      router.refresh();
    });
  }
  function confirmPass(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      await passDeal(deal.id, reason);
      router.refresh();
    });
  }

  return (
    <motion.div
      onClick={onOpen}
      style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderColor: "rgba(0,0,0,0.06)" }}
      whileHover={{
        y: -2,
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        borderColor: "rgba(212,175,55,0.3)",
      }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex cursor-pointer flex-col rounded-2xl border bg-card p-5 text-left"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base text-primary">{deal.property_address}</h3>
          {locality && <p className="truncate text-xs text-muted-foreground">{locality}</p>}
        </div>
        <StructureBadge structure={deal.structure_type} />
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <StatusBadge status={deal.status} />
        {deal.acquisition_grade == null && deal.stabilization_grade == null ? (
          <PendingGradeBadge />
        ) : (
          <div className="flex items-center gap-2.5">
            <GradeBadge caption="Acq" value={deal.acquisition_grade ?? 0} />
            <GradeBadge caption="Stab" value={deal.stabilization_grade ?? 0} />
          </div>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3 border-t border-border pt-4">
        <Metric label="Purchase" value={moneyCompact(deal.purchase_price)} />
        <Metric label="ARV" value={moneyCompact(deal.arv)} />
        <Metric label="Equity Spread" value={moneyCompact(spread)} accent />
      </dl>

      {deal.status === "pending" ? (
        <div className="mt-4 border-t border-border pt-4" onClick={(e) => e.stopPropagation()}>
          {passing ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for passing (optional)"
                className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={confirmPass}
                  className="flex-1 rounded-full bg-destructive/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive disabled:opacity-60"
                >
                  Confirm Pass
                </button>
                <button
                  type="button"
                  onClick={() => setPassing(false)}
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
                onClick={accept}
                className="flex-1 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  setPassing(true);
                }}
                className="flex-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-secondary disabled:opacity-60"
              >
                Pass
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {deal.kp_count} {deal.kp_count === 1 ? "KP" : "KPs"}
          </span>
          <span>{updatedLabel(daysSince(deal.updated_at))}</span>
        </div>
      )}
    </motion.div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          "data-number mt-1 text-sm font-medium tabular-nums " +
          (accent ? "text-accent" : "text-primary")
        }
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel (4 tabs)
// ---------------------------------------------------------------------------

const TABS = ["Overview", "AI Underwriting", "Documents", "Activity"] as const;
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

  // Reset to Overview when a different deal opens.
  useEffect(() => {
    if (open) setTab("Overview");
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

  // ESC closes; lock scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

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
    <div
      aria-hidden={!open}
      className={"fixed inset-0 z-40 " + (open ? "" : "pointer-events-none")}
    >
      <div
        onClick={onClose}
        className={
          "absolute inset-0 bg-primary/40 backdrop-blur-[1px] transition-opacity duration-200 " +
          (open ? "opacity-100" : "opacity-0")
        }
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={deal ? `Deal detail: ${deal.property_address}` : undefined}
        className={
          "absolute right-0 top-0 flex h-full w-full max-w-lg flex-col bg-card shadow-2xl transition-transform duration-200 ease-out " +
          (open ? "translate-x-0" : "translate-x-full")
        }
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

            {/* Tabs */}
            <div className="flex border-b border-border px-2">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    "-mb-px border-b-2 px-3 py-2.5 text-xs font-medium transition-colors " +
                    (tab === t
                      ? "border-accent text-primary"
                      : "border-transparent text-muted-foreground hover:text-primary")
                  }
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {tab === "Overview" && <OverviewTab deal={deal} />}
              {tab === "AI Underwriting" && (
                <AiTab deal={deal} running={running} onRun={onRun} />
              )}
              {tab === "Documents" && (
                <DocumentsTab loading={loadingDetail} detail={detail} />
              )}
              {tab === "Activity" && (
                <ActivityTab loading={loadingDetail} detail={detail} />
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function OverviewTab({ deal }: { deal: Deal }) {
  const assetType = deal.ai_analysis?.extracted_deal_data?.property_type ?? "—";
  return (
    <Section title="Overview">
      <Row label="Address" value={deal.property_address} mono={false} />
      <Row label="Asset Type" value={assetType} mono={false} />
      <Row label="Purchase Price" value={money(deal.purchase_price)} />
      <Row label="ARV" value={money(deal.arv)} />
      <Row label="Equity Spread" value={money(equitySpread(deal))} />
      <Row label="ACQ Grade" value={deal.acquisition_grade != null ? `${deal.acquisition_grade} / 100` : "—"} />
      <Row label="STAB Grade" value={deal.stabilization_grade != null ? `${deal.stabilization_grade} / 100` : "—"} />
      <Row label="Capital Runway Multiple" value={capitalRunwayMultiple(deal)} />
    </Section>
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
              Recommendation
            </div>
            <div className="mt-1 text-lg font-medium">
              {RECOMMENDATION_LABELS[uw.recommendation]}
            </div>
            <div className="mt-2 flex gap-6 text-sm">
              <span className="data-number">ACQ {uw.acquisition_grade}</span>
              <span className="data-number">STAB {uw.stabilization_grade}</span>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{uw.summary}</p>
          <BulletBlock title="Strengths" items={uw.strengths} />
          <BulletBlock title="Risks" items={uw.risks} />
          <BulletBlock title="Conditions" items={uw.conditions} />
        </div>
      )}
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

function DocumentsTab({
  loading,
  detail,
}: {
  loading: boolean;
  detail: DealDetail | null;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const docs = detail?.documents ?? [];
  if (docs.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No documents on file.
      </p>
    );
  return (
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
