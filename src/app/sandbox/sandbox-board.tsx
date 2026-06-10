"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createSandbox } from "./actions";

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
  modules: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  const hr = Math.floor(ms / 3_600_000);
  const day = Math.floor(ms / 86_400_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day === 1) return "yesterday";
  return `${day}d ago`;
}

const TEMPLATE_COLORS: Record<string, { bg: string; text: string }> = {
  "Curative Title":       { bg: "bg-blue-500/15",   text: "text-blue-600" },
  "Wholesale Pipeline":   { bg: "bg-violet-500/15", text: "text-violet-600" },
  "Creative Finance":     { bg: "bg-accent/15",     text: "text-amber-700" },
  "Content Strategy":     { bg: "bg-cyan-500/15",   text: "text-cyan-700" },
  "Multifamily Strategy": { bg: "bg-orange-500/15", text: "text-orange-700" },
  "Business Acquisition": { bg: "bg-indigo-500/15", text: "text-indigo-700" },
  "Blank":                { bg: "bg-secondary",     text: "text-muted-foreground" },
};

const STATUS_CONFIG: Record<string, { dot: string; ring: string; label: string }> = {
  active:   { dot: "bg-emerald-500", ring: "text-emerald-700 bg-emerald-500/15 ring-emerald-500/30", label: "Active" },
  building: { dot: "bg-amber-500",   ring: "text-amber-700 bg-accent/15 ring-accent/30",            label: "Building" },
  idle:     { dot: "bg-gray-400",    ring: "text-muted-foreground bg-secondary ring-border",         label: "Idle" },
  archived: { dot: "bg-rose-500",    ring: "text-rose-600 bg-rose-500/10 ring-rose-400/20",          label: "Archived" },
};

const TEMPLATES = [
  { key: "Curative Title",       desc: "Track title defects and remediation" },
  { key: "Wholesale Pipeline",   desc: "End-to-end wholesale deal flow" },
  { key: "Creative Finance",     desc: "Morby Method and seller carry deals" },
  { key: "Content Strategy",     desc: "Marketing and content planning" },
  { key: "Multifamily Strategy", desc: "Multi-unit acquisition pipeline" },
  { key: "Business Acquisition", desc: "Business purchase and integration" },
  { key: "Blank",                desc: "Start from scratch" },
];

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function StatBar({ stats }: { stats: SandboxStats }) {
  return (
    <div className="mb-6 rounded-xl bg-[#0a1628] px-5 py-4 text-white">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total Sandboxes"   value={String(stats.total)}   />
        <Stat label="Active Strategies" value={String(stats.active)}  />
        <Stat label="Team Members"      value="2"                     />
        <Stat label="Modules Built"     value={String(stats.modules)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-medium uppercase tracking-widest text-white/40">{label}</div>
      <div className="data-number mt-0.5 text-xl font-semibold tabular-nums text-[#c9a84c]">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sandbox card
// ---------------------------------------------------------------------------

function SandboxCard({ sandbox, onClick }: { sandbox: SandboxRow; onClick: () => void }) {
  const tpl = sandbox.template ?? "Blank";
  const tplColor = TEMPLATE_COLORS[tpl] ?? TEMPLATE_COLORS["Blank"];
  const s = STATUS_CONFIG[sandbox.status] ?? STATUS_CONFIG["idle"];

  return (
    <motion.div
      onClick={onClick}
      style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderColor: "rgba(0,0,0,0.06)" }}
      whileHover={{ y: -2, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", borderColor: "rgba(212,175,55,0.3)" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex cursor-pointer flex-col rounded-2xl border bg-card p-5 text-left"
    >
      {/* Top row — category + status */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tplColor.bg} ${tplColor.text}`}>
          {tpl}
        </span>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${s.ring}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>

      {/* Title + description */}
      <h3 className="mb-1 text-base font-medium text-primary leading-snug">
        {sandbox.title ?? "Untitled"}
      </h3>
      {sandbox.description && (
        <p className="mb-3 line-clamp-2 text-sm text-muted-foreground leading-relaxed">
          {sandbox.description}
        </p>
      )}

      <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
        {/* Avatars */}
        <div className="flex -space-x-1.5">
          {[
            { initials: "JM", title: "John Masingale" },
            { initials: "LO", title: "Loammi" },
          ].map((a) => (
            <span
              key={a.initials}
              title={a.title}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0a1628] text-[9px] font-bold text-[#c9a84c] ring-2 ring-card"
            >
              {a.initials}
            </span>
          ))}
        </div>

        {/* Module count + time */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
              <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
              <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
              <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            {sandbox.module_count} {sandbox.module_count === 1 ? "module" : "modules"}
          </span>
          <span>{timeAgo(sandbox.updated_at)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// New Sandbox card
// ---------------------------------------------------------------------------

function NewSandboxCard({ onClick }: { onClick: () => void }) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={{ y: -2, borderColor: "rgba(212,175,55,0.5)" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex min-h-[172px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-5 text-center transition-colors hover:bg-card"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-2xl font-light text-muted-foreground">
        +
      </span>
      <div>
        <p className="text-sm font-medium text-primary">New Sandbox</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Create a new workspace</p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// New Sandbox modal
// ---------------------------------------------------------------------------

function NewSandboxModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("Blank");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function reset() {
    setTitle("");
    setDescription("");
    setTemplate("Blank");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createSandbox({ title, description, template });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      handleClose();
      router.push(`/sandbox/${res.id}`);
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[1px]" onClick={handleClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg text-primary">New Sandbox</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          {/* Title */}
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Title *
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Q3 Wholesale Push"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>

          {/* Description */}
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this sandbox for?"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>

          {/* Template picker */}
          <div>
            <span className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Template
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {TEMPLATES.map((t) => {
                const tplColor = TEMPLATE_COLORS[t.key] ?? TEMPLATE_COLORS["Blank"];
                const selected = template === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTemplate(t.key)}
                    className={
                      "flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all duration-150 " +
                      (selected
                        ? "border-accent bg-accent/5 shadow-sm"
                        : "border-border bg-secondary hover:border-border/80 hover:bg-secondary/70")
                    }
                  >
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tplColor.bg} ${tplColor.text}`}>
                      {t.key}
                    </span>
                    <span className="text-[11px] text-muted-foreground leading-snug">{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create Sandbox"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
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
  const [adding, setAdding] = useState(false);

  const filtered = sandboxes.filter((s) =>
    !query || (s.title ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mx-auto max-w-7xl px-8 py-8"
    >
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight text-primary">Sandbox</h1>
          <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
            Strategy workspaces for deals, content, and outreach.
          </p>
        </div>
      </header>

      <StatBar stats={stats} />

      {/* Search */}
      <div className="mb-6 relative">
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
          <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sandboxes…"
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 && query ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-primary">No sandboxes match &ldquo;{query}&rdquo;</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a different search term.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((sandbox) => (
            <SandboxCard
              key={sandbox.id}
              sandbox={sandbox}
              onClick={() => router.push(`/sandbox/${sandbox.id}`)}
            />
          ))}
          <NewSandboxCard onClick={() => setAdding(true)} />
        </div>
      )}

      {/* Always show New Sandbox card even when search is active with results */}
      {filtered.length === 0 && !query && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <NewSandboxCard onClick={() => setAdding(true)} />
        </div>
      )}

      <NewSandboxModal open={adding} onClose={() => setAdding(false)} />
    </motion.div>
  );
}
