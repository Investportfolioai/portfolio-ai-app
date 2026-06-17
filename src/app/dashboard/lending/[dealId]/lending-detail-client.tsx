"use client";

import { useState, useTransition, useOptimistic } from "react";
import Link from "next/link";
import { toggleChecklistItem, toggleReadinessDoc, createAddendumDraft, draftGmailReply } from "../lending-actions";
import type { ChecklistItem, ReadinessDoc, AddendumDraft, GmailThread } from "./page";

// ---------------------------------------------------------------------------
// Stage metadata
// ---------------------------------------------------------------------------

const STAGE_META: Record<string, { label: string }> = {
  loi:                   { label: "LOI" },
  purchase_contract:     { label: "Purchase Contract" },
  emd_setup:             { label: "EMD & Deal Setup" },
  lender_submission:     { label: "Lender Submission" },
  appraisal_insurance:   { label: "Appraisal & Insurance" },
  clear_to_close:        { label: "Clear to Close" },
  closed:                { label: "Closed" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function readinessColor(value: number) {
  if (value >= 80) return "#22c55e";
  if (value >= 50) return "#f97316";
  return "#ef4444";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  deal: {
    id: string;
    property_address: string;
    stage: string;
    lender_name: string | null;
    asset_type: string;
    asset_class: "commercial" | "residential";
  };
  checklistByStage: Record<string, ChecklistItem[]>;
  stageOrder: string[];
  readinessDocs: ReadinessDoc[];
  addendumDrafts: AddendumDraft[];
  gmailThreads: GmailThread[];
  gmailConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LendingDetailClient({
  deal,
  checklistByStage,
  stageOrder,
  readinessDocs,
  addendumDrafts,
  gmailThreads,
  gmailConfigured,
}: Props) {
  const allItems = stageOrder.flatMap((s) => checklistByStage[s] ?? []);
  const totalCheck = allItems.length;
  const doneCheck = allItems.filter((i) => i.completed).length;
  const totalReady = readinessDocs.length;
  const doneReady = readinessDocs.filter((d) => d.received).length;
  const readyPct = pct(doneReady, totalReady);

  return (
    <div
      style={{
        background: "#0A0B14",
        minHeight: "100vh",
        padding: "32px 24px",
        fontFamily: "var(--font-body, DM Sans, sans-serif)",
      }}
    >
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        {/* Back link */}
        <Link
          href="/dashboard/lending"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            color: "rgba(255,255,255,0.35)",
            textDecoration: "none",
            marginBottom: "20px",
            transition: "color 150ms ease",
          }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Lending
        </Link>

        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 300,
              color: "#fff",
              fontFamily: "var(--font-display, 'Cormorant Garamond', serif)",
              letterSpacing: "-0.02em",
              marginBottom: "4px",
            }}
          >
            {deal.property_address}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
              {deal.asset_type || "—"} · {deal.asset_class}
            </span>
            {deal.lender_name && (
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
                Lender: {deal.lender_name}
              </span>
            )}
          </div>
        </div>

        {/* Summary strip */}
        <div
          style={{
            background: "#111219",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.05)",
            padding: "20px 24px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "28px",
          }}
        >
          <div>
            <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: "8px" }}>
              Checklist
            </div>
            <div style={{ fontSize: "24px", fontWeight: 300, color: "#fff", fontFamily: "var(--font-display, 'Cormorant Garamond', serif)", marginBottom: "6px" }}>
              {pct(doneCheck, totalCheck)}%
            </div>
            <ProgressBar value={pct(doneCheck, totalCheck)} color="#C9A84C" />
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "4px" }}>
              {doneCheck}/{totalCheck} items
            </div>
          </div>
          <div>
            <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: "8px" }}>
              Lender Readiness
            </div>
            <div style={{ fontSize: "24px", fontWeight: 300, color: readinessColor(readyPct), fontFamily: "var(--font-display, 'Cormorant Garamond', serif)", marginBottom: "6px" }}>
              {readyPct}%
            </div>
            <ProgressBar value={readyPct} color={readinessColor(readyPct)} />
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "4px" }}>
              {doneReady}/{totalReady} docs received
            </div>
          </div>
        </div>

        {/* Main two-column layout */}
        <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "24px", alignItems: "start", minWidth: "640px" }}>
          {/* Left: checklist stepper */}
          <div>
            <SectionLabel>7-Stage Checklist</SectionLabel>
            <ChecklistStepper
              stages={stageOrder}
              byStage={checklistByStage}
              dealId={deal.id}
            />
          </div>

          {/* Right: readiness + addendums + gmail */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <ReadinessPanel docs={readinessDocs} dealId={deal.id} />
            <AddendumPanel dealId={deal.id} drafts={addendumDrafts} />
            <GmailPanel
              threads={gmailThreads}
              configured={gmailConfigured}
              dealId={deal.id}
            />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "11px",
        fontWeight: 600,
        color: "rgba(255,255,255,0.45)",
        marginBottom: "12px",
      }}
    >
      {children}
    </div>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div
      style={{
        height: "4px",
        borderRadius: "2px",
        background: "rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, value)}%`,
          background: color,
          borderRadius: "2px",
          transition: "width 400ms ease",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist stepper
// ---------------------------------------------------------------------------

function ChecklistStepper({
  stages,
  byStage,
  dealId,
}: {
  stages: string[];
  byStage: Record<string, ChecklistItem[]>;
  dealId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(stages[0] ?? null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {stages.map((stage, idx) => {
        const items = byStage[stage] ?? [];
        const done = items.filter((i) => i.completed).length;
        const total = items.length;
        const isOpen = expanded === stage;
        const isComplete = total > 0 && done === total;

        return (
          <StageAccordion
            key={stage}
            stage={stage}
            idx={idx}
            items={items}
            done={done}
            total={total}
            isOpen={isOpen}
            isComplete={isComplete}
            dealId={dealId}
            onToggle={() => setExpanded(isOpen ? null : stage)}
          />
        );
      })}
    </div>
  );
}

function StageAccordion({
  stage,
  idx,
  items,
  done,
  total,
  isOpen,
  isComplete,
  dealId,
  onToggle,
}: {
  stage: string;
  idx: number;
  items: ChecklistItem[];
  done: number;
  total: number;
  isOpen: boolean;
  isComplete: boolean;
  dealId: string;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = STAGE_META[stage] ?? { label: stage };

  return (
    <div
      style={{
        background: "#1a1d27",
        borderRadius: "12px",
        border: `1px solid ${isOpen ? "rgba(201,168,76,0.25)" : "rgba(255,255,255,0.06)"}`,
        overflow: "hidden",
        transition: "border-color 200ms ease",
      }}
    >
      {/* Stage header */}
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Step number / check */}
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            background: isComplete
              ? "rgba(34,197,94,0.15)"
              : "rgba(255,255,255,0.06)",
            border: isComplete
              ? "1px solid rgba(34,197,94,0.4)"
              : "1px solid rgba(255,255,255,0.1)",
            transition: "background 200ms ease, border-color 200ms ease",
          }}
        >
          {isComplete ? (
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <span style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>
              {idx + 1}
            </span>
          )}
        </div>

        {/* Label */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>
            {meta.label}
          </div>
          {total > 0 && (
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", marginTop: "1px" }}>
              {done}/{total} complete
            </div>
          )}
        </div>

        {/* Progress mini-bar */}
        {total > 0 && (
          <div style={{ width: "60px" }}>
            <ProgressBar
              value={pct(done, total)}
              color={isComplete ? "#22c55e" : "#C9A84C"}
            />
          </div>
        )}

        {/* Chevron */}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={hovered ? "#C9A84C" : "rgba(255,255,255,0.2)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transition: "stroke 200ms ease, transform 200ms ease",
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* Expanded items */}
      {isOpen && (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.05)",
            padding: "8px 0 8px",
          }}
        >
          {items.map((item) => (
            <ChecklistRow key={item.id} item={item} dealId={dealId} />
          ))}
          {items.length === 0 && (
            <div style={{ padding: "12px 16px", fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
              No items in this stage.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ item, dealId }: { item: ChecklistItem; dealId: string }) {
  const [optimisticCompleted, setOptimistic] = useOptimistic(item.completed);
  const [, start] = useTransition();

  function toggle() {
    const next = !optimisticCompleted;
    start(async () => {
      setOptimistic(next);
      await toggleChecklistItem(item.id, next, dealId);
    });
  }

  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "8px 16px",
        cursor: "pointer",
        transition: "background 150ms ease",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLLabelElement).style.background = "rgba(255,255,255,0.02)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLLabelElement).style.background = "transparent"; }}
    >
      <input
        type="checkbox"
        checked={optimisticCompleted}
        onChange={toggle}
        style={{ position: "absolute", opacity: 0, width: "1px", height: "1px", pointerEvents: "none" }}
      />
      <div
        aria-hidden="true"
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "4px",
          border: optimisticCompleted
            ? "1px solid rgba(34,197,94,0.6)"
            : "1px solid rgba(255,255,255,0.2)",
          background: optimisticCompleted ? "rgba(34,197,94,0.15)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: "1px",
          transition: "background 150ms ease, border-color 150ms ease",
        }}
      >
        {optimisticCompleted && (
          <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span
        style={{
          fontSize: "13px",
          color: optimisticCompleted ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.8)",
          textDecoration: optimisticCompleted ? "line-through" : "none",
          lineHeight: "1.4",
          transition: "color 150ms ease",
        }}
      >
        {item.item_text}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Lender Readiness panel
// ---------------------------------------------------------------------------

function ReadinessPanel({ docs, dealId }: { docs: ReadinessDoc[]; dealId: string }) {
  const done = docs.filter((d) => d.received).length;
  const total = docs.length;
  const score = pct(done, total);
  const color = readinessColor(score);

  return (
    <div
      style={{
        background: "#1a1d27",
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: "20px",
      }}
    >
      <SectionLabel>Lender Readiness Score</SectionLabel>

      {/* Score header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "12px" }}>
        <span
          style={{
            fontSize: "2rem",
            fontWeight: 300,
            color,
            fontFamily: "var(--font-display, 'Cormorant Garamond', serif)",
          }}
        >
          {score}%
        </span>
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
          {done}/{total} received
        </span>
      </div>

      <ProgressBar value={score} color={color} />

      {/* Doc list */}
      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "2px" }}>
        {docs.map((doc) => (
          <ReadinessDocRow key={doc.id} doc={doc} dealId={dealId} />
        ))}
      </div>
    </div>
  );
}

function ReadinessDocRow({ doc, dealId }: { doc: ReadinessDoc; dealId: string }) {
  const [optimisticReceived, setOptimistic] = useOptimistic(doc.received);
  const [, start] = useTransition();

  function toggle() {
    const next = !optimisticReceived;
    start(async () => {
      setOptimistic(next);
      await toggleReadinessDoc(doc.id, next, dealId);
    });
  }

  return (
    <div
      role="checkbox"
      aria-checked={optimisticReceived}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 0",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        cursor: "pointer",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "14px",
          height: "14px",
          borderRadius: "3px",
          border: optimisticReceived
            ? "1px solid rgba(34,197,94,0.6)"
            : "1px solid rgba(255,255,255,0.15)",
          background: optimisticReceived ? "rgba(34,197,94,0.15)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 150ms ease, border-color 150ms ease",
        }}
      >
        {optimisticReceived && (
          <svg aria-hidden="true" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span
        style={{
          fontSize: "12px",
          color: optimisticReceived ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.7)",
          textDecoration: optimisticReceived ? "line-through" : "none",
          transition: "color 150ms ease",
        }}
      >
        {doc.doc_name}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Addendum drafts panel
// ---------------------------------------------------------------------------

function AddendumPanel({
  dealId,
  drafts,
}: {
  dealId: string;
  drafts: AddendumDraft[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setError(null);
    start(async () => {
      const res = await createAddendumDraft({
        dealId,
        title: title.trim() || "",
        promptText: prompt.trim(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setTitle("");
      setPrompt("");
    });
  }

  return (
    <div
      style={{
        background: "#1a1d27",
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <SectionLabel>Addendum Drafts</SectionLabel>
        <button
          onClick={() => setOpen(!open)}
          style={{
            background: "rgba(201,168,76,0.1)",
            border: "1px solid rgba(201,168,76,0.25)",
            borderRadius: "8px",
            padding: "4px 10px",
            fontSize: "11px",
            fontWeight: 600,
            color: "#C9A84C",
            cursor: "pointer",
          }}
        >
          + Draft
        </button>
      </div>

      {open && (
        <form onSubmit={submit} style={{ marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              padding: "8px 12px",
              fontSize: "12px",
              color: "#fff",
              outline: "none",
              width: "100%",
            }}
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what the lender is asking for…"
            rows={3}
            required
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              padding: "8px 12px",
              fontSize: "12px",
              color: "#fff",
              outline: "none",
              resize: "vertical",
              width: "100%",
              fontFamily: "inherit",
            }}
          />
          {error && <p style={{ fontSize: "11px", color: "#ef4444" }}>{error}</p>}
          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "11px",
                color: "rgba(255,255,255,0.5)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              style={{
                background: "#C9A84C",
                border: "none",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "11px",
                fontWeight: 600,
                color: "#0A0B14",
                cursor: "pointer",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? "Drafting…" : "AI Draft"}
            </button>
          </div>
        </form>
      )}

      {drafts.length === 0 ? (
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>No drafts yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {drafts.map((d) => (
            <DraftRow key={d.id} draft={d} dealId={dealId} />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  draft: "rgba(255,255,255,0.35)",
  in_review: "#f97316",
  finalized: "#22c55e",
};

function DraftRow({ draft, dealId }: { draft: AddendumDraft; dealId: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          gap: "8px",
        }}
      >
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#fff" }}>
            {draft.title ?? `Draft v${draft.version}`}
          </div>
          <div style={{ fontSize: "10px", color: STATUS_COLOR[draft.status] ?? "rgba(255,255,255,0.35)", marginTop: "1px" }}>
            {draft.status} · v{draft.version}
          </div>
        </div>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 150ms ease", flexShrink: 0 }}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "12px" }}>
          <pre
            style={{
              fontSize: "11px",
              color: "rgba(255,255,255,0.7)",
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              lineHeight: 1.6,
              margin: 0,
              maxHeight: "240px",
              overflowY: "auto",
            }}
          >
            {draft.content}
          </pre>
          <div style={{ marginTop: "10px", display: "flex", gap: "6px" }}>
            <ExportDocxButton content={draft.content} title={draft.title ?? `Draft v${draft.version}`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gmail panel
// ---------------------------------------------------------------------------

function GmailPanel({
  threads,
  configured,
  dealId,
}: {
  threads: GmailThread[];
  configured: boolean;
  dealId: string;
}) {
  const unread = threads.filter((t) => t.unread);

  return (
    <div
      style={{
        background: "#1a1d27",
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: "20px",
      }}
    >
      <SectionLabel>Needs Response</SectionLabel>

      {!configured && (
        <div
          style={{
            background: "rgba(249,115,22,0.08)",
            border: "1px solid rgba(249,115,22,0.2)",
            borderRadius: "10px",
            padding: "10px 12px",
            fontSize: "11px",
            color: "#f97316",
            lineHeight: 1.5,
          }}
        >
          Gmail not connected. Add <code>GMAIL_CLIENT_ID</code>, <code>GMAIL_CLIENT_SECRET</code>, and{" "}
          <code>GMAIL_REFRESH_TOKEN</code> to <code>.env.local</code> to surface lender emails here.
        </div>
      )}

      {configured && threads.length === 0 && (
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
          No matching threads found.
        </p>
      )}

      {configured && threads.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {threads.map((thread) => (
            <GmailThreadRow key={thread.id} thread={thread} dealId={dealId} />
          ))}
        </div>
      )}
    </div>
  );
}

function GmailThreadRow({ thread, dealId }: { thread: GmailThread; dealId: string }) {
  const [drafting, startDraft] = useTransition();
  const [drafted, setDrafted] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  function draftReply() {
    startDraft(async () => {
      const res = await draftGmailReply({
        threadId: thread.id,
        to: thread.from,
        subject: thread.subject,
        dealId,
        context: thread.snippet,
      });
      if (!res.ok) { setDraftError(res.error); return; }
      setDrafted(true);
    });
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        borderRadius: "8px",
        border: thread.unread
          ? "1px solid rgba(201,168,76,0.2)"
          : "1px solid rgba(255,255,255,0.04)",
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", fontWeight: thread.unread ? 600 : 400, color: thread.unread ? "#fff" : "rgba(255,255,255,0.7)", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.subject}
          </div>
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>
            {thread.from}
          </div>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.snippet}
          </div>
        </div>
        <button
          onClick={draftReply}
          disabled={drafting || drafted}
          style={{
            background: drafted ? "rgba(34,197,94,0.1)" : "rgba(201,168,76,0.1)",
            border: `1px solid ${drafted ? "rgba(34,197,94,0.25)" : "rgba(201,168,76,0.25)"}`,
            borderRadius: "6px",
            padding: "4px 8px",
            fontSize: "10px",
            fontWeight: 600,
            color: drafted ? "#22c55e" : "#C9A84C",
            cursor: drafting || drafted ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
            opacity: drafting ? 0.6 : 1,
          }}
        >
          {drafting ? "Drafting…" : drafted ? "Drafted" : "AI Draft Reply"}
        </button>
      </div>
      {draftError && (
        <p style={{ fontSize: "10px", color: "#ef4444", marginTop: "4px" }}>{draftError}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Docx export (client-side via docx library)
// ---------------------------------------------------------------------------

function ExportDocxButton({ content, title }: { content: string; title: string }) {
  const [pending, start] = useTransition();

  function exportDocx() {
    start(async () => {
      const { Document, Packer, Paragraph, TextRun } = await import("docx");
      const paragraphs = content.split("\n").map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 24 })],
            spacing: { after: 120 },
          }),
      );
      const doc = new Document({
        sections: [{ children: paragraphs }],
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, "_")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <button
      onClick={exportDocx}
      disabled={pending}
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "10px",
        fontWeight: 600,
        color: "rgba(255,255,255,0.6)",
        cursor: "pointer",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? "Exporting…" : "Export .docx"}
    </button>
  );
}
