"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { deleteSandbox } from "./actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxRow {
  id: string;
  title: string | null;
  description: string | null;
  template: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  module_count: number;
}

export interface SandboxStats {
  total: number;
  active: number;
  members: number;
  modules: number;
}

// ---------------------------------------------------------------------------
// Config maps
// ---------------------------------------------------------------------------

const TEMPLATE_BADGE: Record<string, { bg: string; color: string }> = {
  "Curative Title":       { bg: "rgba(59,130,246,0.12)",   color: "#60a5fa" },
  "Wholesale Pipeline":   { bg: "rgba(139,92,246,0.12)",   color: "#a78bfa" },
  "Creative Finance":     { bg: "rgba(201,168,76,0.12)",   color: "#C9A84C" },
  "Content Strategy":     { bg: "rgba(6,182,212,0.12)",    color: "#22d3ee" },
  "Multifamily Strategy": { bg: "rgba(249,115,22,0.12)",   color: "#fb923c" },
  "Business Acquisition": { bg: "rgba(99,102,241,0.12)",   color: "#818cf8" },
  "Blank":                { bg: "rgba(255,255,255,0.06)",  color: "rgba(255,255,255,0.3)" },
};

const STATUS_MAP: Record<string, { dot: string; label: string }> = {
  active:   { dot: "#22c55e", label: "Active"    },
  building: { dot: "#f97316", label: "Building"  },
  draft:    { dot: "#f97316", label: "Building"  },
  idle:     { dot: "#6b7280", label: "Idle"      },
  archived: { dot: "#ef4444", label: "Archived"  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  const hr  = Math.floor(ms / 3_600_000);
  const day = Math.floor(ms / 86_400_000);
  if (min < 2)  return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr  < 24) return `${hr}h ago`;
  if (day === 1) return "yesterday";
  return `${day}d ago`;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function IconChevron({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 200ms ease", flexShrink: 0 }}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 01-9 9" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function IconPlus({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sandbox card
// ---------------------------------------------------------------------------

function SandboxCard({
  sandbox,
  onClick,
  onDelete,
}: {
  sandbox: SandboxRow;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [menuOpen]);

  const badge  = TEMPLATE_BADGE[sandbox.template ?? "Blank"] ?? TEMPLATE_BADGE["Blank"];
  const status = STATUS_MAP[sandbox.status] ?? STATUS_MAP.idle;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="glass-card"
      style={{
        padding: "20px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        position: "relative",
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        {/* Category badge */}
        <span style={{
          background: badge.bg,
          color: badge.color,
          borderRadius: "999px",
          padding: "2px 10px",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "160px",
        }}>
          {sandbox.template ?? "Blank"}
        </span>

        {/* Status + chevron + menu */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <span style={{
            width: "6px", height: "6px",
            borderRadius: "50%",
            background: status.dot,
            display: "inline-block",
            flexShrink: 0,
          }} />
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>
            {status.label}
          </span>
          <IconChevron color={hovered ? "#C9A84C" : "rgba(255,255,255,0.2)"} />

          {/* 3-dot delete menu */}
          <div ref={menuRef} onClick={(e) => e.stopPropagation()} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              style={{ color: "rgba(255,255,255,0.2)", padding: "2px 4px", lineHeight: 0, background: "none", border: "none", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div style={{
                position: "absolute", right: 0, top: "100%", marginTop: "4px",
                width: "160px", background: "#111828",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px",
                zIndex: 20, overflow: "hidden",
              }}>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  style={{ width: "100%", textAlign: "left", padding: "10px 12px", fontSize: "13px", color: "#f87171", background: "none", border: "none", cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  Delete Sandbox
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Title + description */}
      <div>
        <h3 style={{ color: "white", fontWeight: 600, fontSize: "15px", lineHeight: "1.35", margin: 0 }}>
          {sandbox.title ?? "Untitled"}
        </h3>
        {sandbox.description && (
          <p style={{
            color: "#6b7280", fontSize: "13px", lineHeight: "1.55", marginTop: "4px",
            display: "-webkit-box", WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {sandbox.description}
          </p>
        )}
      </div>

      {/* Bottom row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.05)",
        marginTop: "auto",
      }}>
        {/* Avatar stack */}
        <div style={{ display: "flex" }}>
          {[{ ini: "JM", name: "John Masingale" }, { ini: "LO", name: "Loammi" }].map((a, i) => (
            <span
              key={a.ini}
              title={a.name}
              style={{
                width: "24px", height: "24px", borderRadius: "50%",
                background: "rgba(201,168,76,0.15)", color: "#C9A84C",
                fontSize: "9px", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "2px solid #1a1d27",
                marginLeft: i === 0 ? 0 : "-6px",
              }}
            >
              {a.ini}
            </span>
          ))}
        </div>

        {/* Module count + timestamp */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#6b7280", fontSize: "11px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <IconBranch />
            {sandbox.module_count} {sandbox.module_count === 1 ? "module" : "modules"}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
            <IconClock />
            {timeAgo(sandbox.updated_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Sandbox card
// ---------------------------------------------------------------------------

function NewSandboxCard({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "transparent",
        border: `1.5px dashed ${hovered ? "rgba(201,168,76,0.45)" : "#2a2d3a"}`,
        borderRadius: "16px",
        padding: "20px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "172px",
        gap: "12px",
        boxShadow: hovered
          ? "0 0 0 1px rgba(201,168,76,0.4), 0 8px 24px rgba(201,168,76,0.15)"
          : "none",
        transition: "all 200ms ease",
      }}
    >
      <div style={{
        width: "40px", height: "40px", borderRadius: "50%",
        background: "rgba(201,168,76,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#C9A84C",
      }}>
        <IconPlus size={20} />
      </div>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "white", fontWeight: 500, fontSize: "14px", margin: 0 }}>New Sandbox</p>
        <p style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}>
          Build from a template or scratch
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric stat
// ---------------------------------------------------------------------------

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        fontSize: "9px", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: "6px",
      }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#C9A84C" }}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirm dialog
// ---------------------------------------------------------------------------

function DeleteConfirmDialog({
  title, onCancel, onConfirm, isPending,
}: {
  title: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={onCancel} />
      <div style={{
        position: "relative", width: "100%", maxWidth: "360px", padding: "24px",
        background: "#0d1b30", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
      }}>
        <h2 style={{ color: "white", fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>Delete Sandbox</h2>
        {title && <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px", marginBottom: "12px" }}>&ldquo;{title}&rdquo;</p>}
        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", lineHeight: "1.6", marginBottom: "20px" }}>
          This will permanently delete this sandbox and all its folders and modules. This cannot be undone.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "10px", padding: "8px 16px", fontSize: "13px", color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            style={{
              background: "#ef4444", border: "none", borderRadius: "10px",
              padding: "8px 16px", fontSize: "13px", fontWeight: 500, color: "white",
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function SandboxBoard({
  sandboxes,
  stats,
}: {
  sandboxes: SandboxRow[];
  stats: SandboxStats;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sandboxList, setSandboxList] = useState(sandboxes);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string | null } | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const filtered = sandboxList.filter((s) =>
    !query || (s.title ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    startDelete(async () => {
      const res = await deleteSandbox(targetId);
      if (res.ok) setSandboxList((prev) => prev.filter((s) => s.id !== targetId));
      setDeleteTarget(null);
    });
  }

  const showNewCard = !query || filtered.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      style={{ background: "#0A0B14", minHeight: "100vh", padding: "32px" }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>

        {/* Header */}
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "24px" }}>
          <div>
            <h1 style={{ color: "white", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              Sandboxes
            </h1>
            <p style={{ color: "#6b7280", fontSize: "14px", marginTop: "6px" }}>
              {stats.total} {stats.total === 1 ? "workspace" : "workspaces"} · {stats.active} active now
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/sandbox/new")}
            style={{
              background: "#C9A84C", color: "#0A0B14",
              border: "none", borderRadius: "8px",
              padding: "9px 16px", fontSize: "14px", fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center",
              gap: "6px", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#D4B86A"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#C9A84C"; }}
          >
            <IconPlus size={14} />
            New Sandbox
          </button>
        </header>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: "24px" }}>
          <span style={{
            position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)",
            color: "#6b7280", pointerEvents: "none",
          }}>
            <IconSearch />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sandboxes…"
            className="premium-input"
            style={{
              width: "100%",
              borderRadius: "12px",
              padding: "10px 14px 10px 42px",
              color: "white",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#C9A84C";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(201,168,76,0.12)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Metric strip */}
        <div
          style={{
            background: "#111219",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: "16px",
            padding: "20px 24px",
            marginBottom: "32px",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px",
          }}
        >
          <MetricStat label="Total Sandboxes"   value={String(stats.total)}   />
          <MetricStat label="Active Strategies" value={String(stats.active)}  />
          <MetricStat label="Team Members"      value={String(stats.members)} />
          <MetricStat label="Modules Built"     value={String(stats.modules)} />
        </div>

        {/* Section label */}
        <div style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em",
          color: "rgba(255,255,255,0.25)", textTransform: "uppercase", marginBottom: "16px",
        }}>
          Workspaces
        </div>

        {/* Grid */}
        {filtered.length === 0 && query ? (
          <div style={{
            background: "#1a1d27",
            border: "1px dashed rgba(255,255,255,0.08)",
            borderRadius: "16px",
            padding: "64px 32px",
            textAlign: "center",
          }}>
            <p style={{ color: "rgba(255,255,255,0.45)", fontWeight: 500, fontSize: "14px" }}>
              No sandboxes match &ldquo;{query}&rdquo;
            </p>
            <p style={{ color: "#6b7280", fontSize: "13px", marginTop: "4px" }}>
              Try a different search term.
            </p>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "16px",
          }}>
            {filtered.map((sandbox) => (
              <SandboxCard
                key={sandbox.id}
                sandbox={sandbox}
                onClick={() => router.push(`/sandbox/${sandbox.id}`)}
                onDelete={() => setDeleteTarget({ id: sandbox.id, title: sandbox.title })}
              />
            ))}
            {showNewCard && <NewSandboxCard onClick={() => router.push("/sandbox/new")} />}
          </div>
        )}

        {/* Empty state (no sandboxes at all) */}
        {sandboxList.length === 0 && !query && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "16px",
          }}>
            <NewSandboxCard onClick={() => router.push("/sandbox/new")} />
          </div>
        )}

      </div>

      {deleteTarget && (
        <DeleteConfirmDialog
          title={deleteTarget.title}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          isPending={isDeleting}
        />
      )}
    </motion.div>
  );
}
