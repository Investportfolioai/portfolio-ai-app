"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type Deal,
  type DealStage,
  type DealStructure,
  EXIT_LABELS,
  ROLE_LABELS,
  STAGE_BADGE,
  STAGE_LABELS,
  STAGE_ORDER,
  STRUCTURE_LABELS,
  daysSince,
  equitySpread,
} from "@/lib/types";
import {
  money,
  moneyCompact,
  percent,
  percentFromRatio,
  updatedLabel,
} from "@/lib/format";

export function PipelineBoard({ deals }: { deals: Deal[] }) {
  const [stage, setStage] = useState<DealStage | "all">("all");
  const [structure, setStructure] = useState<DealStructure | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Only offer filters for values that actually appear in the book.
  const stages = useMemo(
    () => STAGE_ORDER.filter((s) => deals.some((d) => d.stage === s)),
    [deals],
  );
  const structures = useMemo(
    () =>
      (Object.keys(STRUCTURE_LABELS) as DealStructure[]).filter((s) =>
        deals.some((d) => d.structure_type === s),
      ),
    [deals],
  );

  const filtered = useMemo(
    () =>
      deals.filter(
        (d) =>
          (stage === "all" || d.stage === stage) &&
          (structure === "all" || d.structure_type === structure),
      ),
    [deals, stage, structure],
  );

  const selected = deals.find((d) => d.id === selectedId) ?? null;

  return (
    <div>
      <div className="mb-5 space-y-3">
        <FilterRow label="Stage">
          <Chip active={stage === "all"} onClick={() => setStage("all")}>
            All
          </Chip>
          {stages.map((s) => (
            <Chip key={s} active={stage === s} onClick={() => setStage(s)}>
              {STAGE_LABELS[s]}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label="Structure">
          <Chip active={structure === "all"} onClick={() => setStructure("all")}>
            All
          </Chip>
          {structures.map((s) => (
            <Chip
              key={s}
              active={structure === s}
              onClick={() => setStructure(s)}
            >
              {STRUCTURE_LABELS[s]}
            </Chip>
          ))}
        </FilterRow>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasDeals={deals.length > 0} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onClick={() => setSelectedId(deal.id)}
            />
          ))}
        </div>
      )}

      <DealPanel deal={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </div>
  );
}

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
        "rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors " +
        (active
          ? "bg-navy-900 text-white ring-navy-900"
          : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300")
      }
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StructureBadge({ structure }: { structure: DealStructure }) {
  return (
    <span className="rounded bg-navy-900 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold-soft ring-1 ring-gold/30">
      {STRUCTURE_LABELS[structure]}
    </span>
  );
}

function StageBadge({ stage }: { stage: DealStage }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 " +
        (STAGE_BADGE[stage] ?? "bg-slate-100 text-slate-600 ring-slate-200")
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function DealCard({ deal, onClick }: { deal: Deal; onClick: () => void }) {
  const spread = equitySpread(deal);
  const locality = [deal.city, deal.state].filter(Boolean).join(", ");

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-navy-900">
            {deal.property_address}
          </h3>
          {locality && (
            <p className="truncate text-xs text-slate-500">{locality}</p>
          )}
        </div>
        <StructureBadge structure={deal.structure_type} />
      </div>

      <div className="mb-4">
        <StageBadge stage={deal.stage} />
      </div>

      <dl className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        <Metric label="Purchase" value={moneyCompact(deal.purchase_price)} />
        <Metric label="ARV" value={moneyCompact(deal.arv)} />
        <Metric label="Equity Spread" value={moneyCompact(spread)} accent />
      </dl>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>
          {deal.kp_count} {deal.kp_count === 1 ? "KP" : "KPs"}
        </span>
        <span>{updatedLabel(daysSince(deal.updated_at))}</span>
      </div>
    </button>
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
      <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd
        className={
          "mt-0.5 text-sm font-semibold tabular-nums " +
          (accent ? "text-gold" : "text-navy-900")
        }
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

/** Whole months between two ISO dates, or null. */
function termMonths(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return Math.max(0, months);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function DealPanel({
  deal,
  onClose,
}: {
  deal: Deal | null;
  onClose: () => void;
}) {
  const open = deal !== null;

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const spread = deal ? equitySpread(deal) : null;
  const locality = deal
    ? [deal.city, deal.state].filter(Boolean).join(", ")
    : "";
  const term = deal
    ? termMonths(deal.acquisition_date, deal.projected_close_date)
    : null;
  const principals = deal
    ? [
        { who: deal.owner, tag: "Owner" },
        { who: deal.coowner, tag: "Co-owner" },
      ].filter((p) => p.who)
    : [];

  return (
    <div
      aria-hidden={!open}
      className={"fixed inset-0 z-40 " + (open ? "" : "pointer-events-none")}
    >
      {/* Overlay */}
      <div
        onClick={onClose}
        className={
          "absolute inset-0 bg-navy-950/40 backdrop-blur-[1px] transition-opacity duration-200 " +
          (open ? "opacity-100" : "opacity-0")
        }
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={deal ? `Deal detail: ${deal.property_address}` : undefined}
        className={
          "absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-200 ease-out " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        {deal && (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-navy-900 px-6 py-5 text-white">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                  <StructureBadge structure={deal.structure_type} />
                  <StageBadge stage={deal.stage} />
                </div>
                <h2 className="truncate text-lg font-semibold">
                  {deal.property_address}
                </h2>
                {locality && (
                  <p className="text-sm text-slate-300">{locality}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mb-6 rounded-lg bg-gold/10 p-4 ring-1 ring-gold/30">
                <div className="text-xs font-medium uppercase tracking-wider text-amber-700">
                  Equity Spread
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-navy-900">
                  {money(spread)}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  ARV less loan amount
                </div>
              </div>

              <Section title="Capital Structure">
                <Row label="Purchase Price" value={money(deal.purchase_price)} />
                <Row label="ARV" value={money(deal.arv)} />
                <Row label="Loan Amount" value={money(deal.loan_amount)} />
                <Row label="Initial Advance" value={money(deal.initial_advance)} />
                <Row label="Holdback" value={money(deal.holdback)} />
                <Row label="LTV" value={percentFromRatio(deal.ltv)} />
                <Row label="Interest Rate" value={percent(deal.interest_rate)} />
                <Row
                  label="Term"
                  value={term != null ? `${term} months` : "—"}
                />
              </Section>

              <Section title="Seller Note & Fees">
                <Row
                  label="Seller Note"
                  value={money(deal.seller_note_amount)}
                />
                <Row
                  label="Seller Note Rate"
                  value={percent(deal.seller_note_rate)}
                />
                <Row label="Assignment Fee" value={money(deal.assignment_fee)} />
                <Row
                  label="Origination Fee"
                  value={money(deal.origination_fee)}
                />
              </Section>

              <Section title="Lender & Exit">
                <Row label="Lender" value={deal.lender_name ?? "—"} />
                <Row label="Quote #" value={deal.quote_number ?? "—"} />
                <Row
                  label="Exit Strategy"
                  value={deal.exit_strategy ? EXIT_LABELS[deal.exit_strategy] : "—"}
                />
                <Row
                  label="Acquisition"
                  value={fmtDate(deal.acquisition_date)}
                />
                <Row
                  label="Projected Close"
                  value={fmtDate(deal.projected_close_date)}
                />
              </Section>

              <Section title="Principals">
                {principals.length === 0 ? (
                  <Row label="Assigned" value="—" />
                ) : (
                  principals.map((p) => (
                    <Row
                      key={p.tag}
                      label={p.tag}
                      value={`${p.who!.full_name ?? "Unnamed"} · ${ROLE_LABELS[p.who!.role]}`}
                    />
                  ))
                )}
                <Row label="KPs Attached" value={String(deal.kp_count)} />
              </Section>

              {deal.ai_summary && (
                <Section title="AI Underwriting">
                  <p className="px-3 py-2.5 text-sm leading-relaxed text-slate-600">
                    {deal.ai_summary}
                  </p>
                </Section>
              )}

              {deal.notes && (
                <Section title="Notes">
                  <p className="px-3 py-2.5 text-sm leading-relaxed text-slate-600">
                    {deal.notes}
                  </p>
                </Section>
              )}

              <p className="mt-2 text-right text-xs text-slate-400">
                {updatedLabel(daysSince(deal.updated_at))}
              </p>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h3>
      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-100">
        {children}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className="truncate text-right text-sm font-medium tabular-nums text-navy-900">
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ hasDeals }: { hasDeals: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <p className="text-sm font-medium text-navy-900">
        {hasDeals ? "No deals match these filters" : "No deals yet"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {hasDeals
          ? "Try clearing the stage or structure filter."
          : "Deals will appear here once they're in the book."}
      </p>
    </div>
  );
}
