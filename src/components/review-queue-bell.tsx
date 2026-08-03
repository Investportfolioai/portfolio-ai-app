"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getPendingDealUpdatesCount,
  getPendingDealUpdates,
  approveDealUpdate,
  rejectDealUpdate,
  type PendingDealUpdate,
  type ApproveConflict,
} from "@/app/dashboard/pipeline/deal-updates-actions";
import { DEAL_UPDATE_SOURCE_LABELS } from "@/lib/types";
import { EDITABLE_FIELDS } from "@/lib/editable-fields";

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ReviewQueueBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    getPendingDealUpdatesCount().then(setCount);
  }, []);

  function openPanel() {
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
  }

  function closePanel() {
    setMounted(false);
    setTimeout(() => setOpen(false), 200);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-label={`Review queue${count > 0 ? `, ${count} pending` : ""}`}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "34px",
          height: "34px",
          borderRadius: "50%",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          transition: "color 150ms ease, border-color 150ms ease",
        }}
      >
        <BellIcon />
        {count > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              minWidth: "16px",
              height: "16px",
              padding: "0 4px",
              borderRadius: "999px",
              background: "#C9A84C",
              color: "#0A0B14",
              fontSize: "10px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <ReviewQueuePanel mounted={mounted} onClose={closePanel} onCountChange={setCount} />
      )}
    </>
  );
}

function ReviewQueuePanel({
  mounted,
  onClose,
  onCountChange,
}: {
  mounted: boolean;
  onClose: () => void;
  onCountChange: (n: number) => void;
}) {
  const [items, setItems] = useState<PendingDealUpdate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, ApproveConflict[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const reload = () => {
    getPendingDealUpdates().then((list) => {
      setItems(list);
      onCountChange(list.length);
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function approve(id: string) {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    startTransition(async () => {
      const res = await approveDealUpdate(id);
      setBusyId(null);
      if (res.ok) {
        setConflicts((c) => {
          const next = { ...c };
          delete next[id];
          return next;
        });
        reload();
      } else if (res.conflicts) {
        setConflicts((c) => ({ ...c, [id]: res.conflicts! }));
      } else {
        setErrors((e) => ({ ...e, [id]: res.error }));
      }
    });
  }

  function reject(id: string) {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    startTransition(async () => {
      const res = await rejectDealUpdate(id);
      setBusyId(null);
      if (res.ok) reload();
      else setErrors((e) => ({ ...e, [id]: res.error }));
    });
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(2px)",
          zIndex: 60,
          opacity: mounted ? 1 : 0,
          transition: "opacity 200ms ease",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review Queue"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 100vw)",
          background: "#0f111c",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
          zIndex: 61,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transform: mounted ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display, 'Cormorant Garamond', serif)",
              fontSize: "1.4rem",
              fontWeight: 300,
              color: "#fff",
            }}
          >
            Review Queue
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              color: "rgba(255,255,255,0.4)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <CloseIcon />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {items === null ? (
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>Loading…</p>
          ) : items.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "56px 16px",
                color: "rgba(255,255,255,0.35)",
                fontSize: "13px",
              }}
            >
              Nothing pending — you&apos;re caught up.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {items.map((item) => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  conflicts={conflicts[item.id]}
                  error={errors[item.id]}
                  onApprove={() => approve(item.id)}
                  onReject={() => reject(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ReviewCard({
  item,
  busy,
  conflicts,
  error,
  onApprove,
  onReject,
}: {
  item: PendingDealUpdate;
  busy: boolean;
  conflicts?: ApproveConflict[];
  error?: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const changes = item.proposed_changes ? Object.entries(item.proposed_changes) : [];

  return (
    <div
      style={{
        background: "#1a1d27",
        borderRadius: "16px",
        padding: "16px",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display, 'Cormorant Garamond', serif)",
          fontStyle: "italic",
          fontSize: "1rem",
          color: "#fff",
          marginBottom: "4px",
        }}
      >
        {item.deal_address}
      </div>
      <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", marginBottom: "10px", lineHeight: 1.4 }}>
        {item.summary}
      </div>

      {changes.length > 0 && (
        <div
          style={{
            background: "#111219",
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {changes.map(([field, change]) => (
            <div
              key={field}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
                fontSize: "12px",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "rgba(255,255,255,0.4)" }}>{EDITABLE_FIELDS[field]?.label ?? field}</span>
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  color: "#fff",
                  textAlign: "right",
                }}
              >
                {String(change.was ?? "—")} <span style={{ color: "rgba(255,255,255,0.3)" }}>→</span>{" "}
                <span style={{ color: "#C9A84C" }}>{String(change.new ?? "—")}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", gap: "8px" }}>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "rgba(255,255,255,0.35)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {DEAL_UPDATE_SOURCE_LABELS[item.source]}
          {item.author_name ? ` · ${item.author_name}` : ""}
        </span>
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>{fmtRelative(item.created_at)}</span>
      </div>

      {conflicts && conflicts.length > 0 && (
        <div
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: "12px",
            fontSize: "12px",
            color: "#fca5a5",
            lineHeight: 1.4,
          }}
        >
          This deal changed since proposed — {conflicts.map((c) => c.label).join(", ")} no longer match
          {conflicts.length === 1 ? "es" : ""} what was expected. Reject or resolve manually on the deal.
        </div>
      )}

      {error && !conflicts?.length && (
        <div
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: "12px",
            fontSize: "12px",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          style={{
            flex: 1,
            background: "#C9A84C",
            border: "none",
            borderRadius: "10px",
            padding: "14px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#0A0B14",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            padding: "14px",
            fontSize: "13px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.6)",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
