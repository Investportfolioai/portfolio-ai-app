"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { LendingDeal } from "./page";

const LENDING_STAGE_LABEL: Record<string, string> = {
  loi: "LOI",
  purchase_contract: "Purchase Contract",
  emd_setup: "EMD & Deal Setup",
  lender_submission: "Lender Submission",
  appraisal_insurance: "Appraisal & Insurance",
  clear_to_close: "Clear to Close",
  closed: "Closed",
};

function pct(done: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

function ReadinessBar({ value }: { value: number }) {
  const color = value >= 80 ? "#22c55e" : value >= 50 ? "#f97316" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          flex: 1,
          height: "4px",
          borderRadius: "2px",
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${value}%`,
            background: color,
            borderRadius: "2px",
            transition: "width 400ms ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: "11px",
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          color,
          fontWeight: 500,
          minWidth: "34px",
          textAlign: "right",
        }}
      >
        {value}%
      </span>
    </div>
  );
}

function NudgeLenderButton({ deal }: { deal: LendingDeal }) {
  const [state, setState] = useState<"idle" | "drafting" | "done" | "error">("idle");
  const [, start] = useTransition();

  function nudge(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!deal.lender_name) return;
    setState("drafting");
    start(async () => {
      try {
        // Draft a follow-up via Gmail MCP — open mailto as fallback
        const subject = encodeURIComponent(`Follow-up — ${deal.property_address}`);
        const body = encodeURIComponent(
          `Hi,\n\nFollowing up on ${deal.property_address}. Could you provide a status update on our submission?\n\nThank you.`,
        );
        window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
        setState("done");
      } catch {
        setState("error");
      }
    });
  }

  if (!deal.lender_name) return null;

  return (
    <button
      onClick={nudge}
      disabled={state === "drafting"}
      style={{
        background: "rgba(201,168,76,0.1)",
        border: "1px solid rgba(201,168,76,0.25)",
        borderRadius: "8px",
        padding: "5px 12px",
        fontSize: "11px",
        fontWeight: 600,
        color: state === "done" ? "#22c55e" : state === "error" ? "#ef4444" : "#C9A84C",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "color 150ms ease, background 150ms ease, border-color 150ms ease",
        flexShrink: 0,
      }}
    >
      {state === "drafting" ? "Drafting…" : state === "done" ? "Drafted" : state === "error" ? "Failed" : "Nudge Lender"}
    </button>
  );
}

export function LendingBoard({ deals }: { deals: LendingDeal[] }) {
  return (
    <div
      style={{
        background: "#0A0B14",
        minHeight: "100vh",
        padding: "32px 24px",
        fontFamily: "var(--font-body, DM Sans, sans-serif)",
      }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
          <div>
            <h1
              style={{
                fontSize: "2.5rem",
                fontWeight: 300,
                color: "#fff",
                fontFamily: "var(--font-display, 'Cormorant Garamond', serif)",
                letterSpacing: "-0.02em",
                marginBottom: "4px",
              }}
            >
              Lending
            </h1>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)" }}>
              {deals.length} active deal{deals.length !== 1 ? "s" : ""} in the lending pipeline
            </p>
          </div>
          <Link
            href="/dashboard/lending/reference"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "10px",
              padding: "9px 16px",
              fontSize: "12px",
              fontWeight: 500,
              color: "rgba(255,255,255,0.55)",
              textDecoration: "none",
              transition: "all 150ms ease",
            }}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Reference Docs
          </Link>
        </div>

        {/* Column headers + rows with horizontal scroll on narrow viewports */}
        <div style={{ overflowX: "auto" }}>
        {/* Column headers */}
        {deals.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px 160px 160px 120px",
              gap: "16px",
              padding: "0 20px 8px",
              minWidth: "660px",
            }}
          >
            {["Deal", "Stage", "Checklist", "Readiness Score", ""].map((h, i) => (
              <div
                key={h || String(i)}
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "rgba(255,255,255,0.25)",
                }}
              >
                {h}
              </div>
            ))}
          </div>
        )}

        {/* Deal rows */}
        {deals.length === 0 ? (
          <div
            style={{
              background: "#1a1d27",
              borderRadius: "16px",
              border: "2px dashed #2a2d3a",
              padding: "60px 24px",
              textAlign: "center",
            }}
          >
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
              No active deals in the lending pipeline.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {deals.map((deal) => (
              <DealRow key={deal.id} deal={deal} />
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function DealRow({ deal }: { deal: LendingDeal }) {
  const [hovered, setHovered] = useState(false);
  const checkPct = pct(deal.checklist_done, deal.checklist_total);
  const readyPct = pct(deal.readiness_done, deal.readiness_total);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 140px 160px 160px 120px",
        gap: "16px",
        alignItems: "center",
        background: "#1a1d27",
        borderRadius: "12px",
        padding: "16px 20px",
        border: `1px solid ${hovered ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.06)"}`,
        boxShadow: hovered ? "0 0 0 1px rgba(201,168,76,0.4), 0 8px 24px rgba(201,168,76,0.15)" : "none",
        transition: "border-color 200ms ease, box-shadow 200ms ease",
        cursor: "pointer",
        textDecoration: "none",
        position: "relative",
        minWidth: "660px",
      }}
    >
      {/* Deal name — wraps the row in a Link */}
      <Link
        href={`/dashboard/lending/${deal.id}`}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "12px",
          zIndex: 0,
        }}
        aria-label={deal.property_address}
      />

      {/* Col 1: address + lender */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "2px" }}>
          {deal.property_address}
        </div>
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
          {deal.lender_name ?? "No lender set"} · {deal.asset_type ?? "—"}
        </div>
      </div>

      {/* Col 2: stage */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: "999px",
            padding: "2px 10px",
            fontSize: "10px",
            fontWeight: 600,
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          {LENDING_STAGE_LABEL[deal.effective_stage] ?? deal.effective_stage}
        </span>
      </div>

      {/* Col 3: checklist % */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {deal.checklist_total > 0 ? (
          <div>
            <ReadinessBar value={checkPct} />
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>
              {deal.checklist_done}/{deal.checklist_total} items
            </div>
          </div>
        ) : (
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>Not seeded</span>
        )}
      </div>

      {/* Col 4: readiness score */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {deal.readiness_total > 0 ? (
          <div>
            <ReadinessBar value={readyPct} />
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>
              {deal.readiness_done}/{deal.readiness_total} docs
            </div>
          </div>
        ) : (
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>Not seeded</span>
        )}
      </div>

      {/* Col 5: nudge */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "flex-end" }}>
        <NudgeLenderButton deal={deal} />
      </div>
    </div>
  );
}
