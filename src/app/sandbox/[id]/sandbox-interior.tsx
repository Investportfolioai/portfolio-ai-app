"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { buildModule, addFolder, type BuiltModule, type AddedFolder } from "./actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxFolder {
  id: string;
  name: string | null;
  folder_type: string | null;
  position: number;
}

export interface SandboxModule {
  id: string;
  folder_id: string | null;
  title: string | null;
  description: string | null;
  folder_type: string | null;
  status: string;
  created_at: string;
}

export interface SandboxDetail {
  id: string;
  title: string | null;
  template: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Folder type options
// ---------------------------------------------------------------------------

const FOLDER_TYPES = [
  { label: "Deals", value: "deals" },
  { label: "Follow-Up Sequences", value: "follow_up" },
  { label: "Title Cure", value: "title_cure" },
  { label: "Documents", value: "documents" },
  { label: "Cold Call Scripts", value: "cold_call" },
  { label: "Content", value: "content" },
];

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconSparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4M22 5h-4" />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22 11 13 2 9l20-7z" />
    </svg>
  );
}

function IconBarChart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconFolderOpen({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Suggested prompts
// ---------------------------------------------------------------------------

const SUGGESTED_PROMPTS: Record<string, [string, string, string]> = {
  deals: [
    "Build a deal intake form",
    "Create an offer comparison tracker",
    "Generate a KP assignment workflow",
  ],
  follow_up: [
    "Build a 5-step seller follow-up sequence",
    "Create a cold lead reactivation script",
    "Generate a post-offer follow-up",
  ],
  title_cure: [
    "Build a title cure checklist",
    "Create an heir outreach tracker",
    "Generate a lien resolution workflow",
  ],
  documents: [
    "Build a document request checklist",
    "Create an NDA template",
    "Generate a deal brief template",
  ],
  cold_call: [
    "Build a seller cold call script",
    "Create an objection handling guide",
    "Generate a voicemail script",
  ],
  content: [
    "Build a content calendar",
    "Create a hook library",
    "Generate a platform breakdown",
  ],
};

const DEFAULT_PROMPTS: [string, string, string] = [
  "Build a tracker",
  "Create a workflow",
  "Generate a template",
];

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === "live"
      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
      : "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/25";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg}`}>
      {status === "live" ? "Live" : "Draft"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Module card
// ---------------------------------------------------------------------------

function ModuleCard({
  mod,
  creatorName,
}: {
  mod: SandboxModule | BuiltModule;
  creatorName: string;
}) {
  const date = new Date(mod.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex flex-col gap-3 rounded-xl border border-white/8 bg-[#0d1b30] p-5 transition-all duration-200 hover:border-[#c9a84c]/30 hover:shadow-lg hover:shadow-black/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#c9a84c]/10">
          <IconBarChart className="h-4 w-4 text-[#c9a84c]" />
        </div>
        <StatusBadge status={mod.status} />
      </div>
      <div className="flex-1">
        <h3 className="text-sm font-semibold leading-snug text-white">
          {mod.title ?? "Untitled Module"}
        </h3>
        {mod.description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-white/50">
            {mod.description}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-white/30">{creatorName}</span>
        <span className="text-[11px] text-white/30">{date}</span>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ folderName }: { folderName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-white/8 bg-[#0d1b30]">
        <IconFolderOpen className="h-6 w-6 text-white/20" />
      </div>
      <p className="text-sm font-medium text-white/40">{folderName} is empty</p>
      <p className="mt-1 text-[13px] text-white/25">
        Use the AI Builder below to create your first module
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Folder Modal
// ---------------------------------------------------------------------------

function AddFolderModal({
  onClose,
  onAdd,
  isPending,
  error,
}: {
  onClose: () => void;
  onAdd: (name: string, folderType: string) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [selectedType, setSelectedType] = useState(FOLDER_TYPES[0].value);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || isPending) return;
    onAdd(name, selectedType);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#0d1b30] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">New Folder</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-white/30 transition-colors hover:bg-white/8 hover:text-white/70"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name input */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
              Folder Name
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Seller Leads"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-[#c9a84c]/40 focus:bg-[#c9a84c]/5"
            />
          </div>

          {/* Folder type selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
              Type
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {FOLDER_TYPES.map((ft) => (
                <button
                  key={ft.value}
                  type="button"
                  onClick={() => setSelectedType(ft.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-[12px] font-medium transition-colors ${
                    selectedType === ft.value
                      ? "border-[#c9a84c]/50 bg-[#c9a84c]/10 text-[#c9a84c]"
                      : "border-white/8 bg-white/3 text-white/50 hover:border-white/15 hover:text-white/80"
                  }`}
                >
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[12px] text-rose-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-white/50 transition-colors hover:bg-white/8 hover:text-white/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isPending}
              className="flex flex-1 items-center justify-center rounded-lg bg-[#c9a84c] py-2 text-sm font-medium text-[#070f1c] transition-all hover:bg-[#e0c060] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isPending ? (
                <IconLoader className="h-4 w-4 animate-spin" />
              ) : (
                "Create"
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SandboxInterior({
  sandbox,
  folders: initialFolders,
  modules: initialModules,
  creatorName,
}: {
  sandbox: SandboxDetail;
  folders: SandboxFolder[];
  modules: SandboxModule[];
  creatorName: string;
}) {
  const [folderList, setFolderList] = useState<SandboxFolder[]>(initialFolders);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(
    initialFolders[0]?.id ?? null,
  );
  const [modules, setModules] = useState<(SandboxModule | BuiltModule)[]>(initialModules);

  // AI Builder state
  const [prompt, setPrompt] = useState("");
  const [buildError, setBuildError] = useState<string | null>(null);
  const [isBuildPending, startBuildTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Add Folder modal state
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [isAddPending, startAddTransition] = useTransition();

  // Sync from server revalidation
  useEffect(() => { setModules(initialModules); }, [initialModules]);
  useEffect(() => { setFolderList(initialFolders); }, [initialFolders]);

  const activeFolder = folderList.find((f) => f.id === activeFolderId) ?? folderList[0] ?? null;
  const visibleModules = modules.filter((m) => m.folder_id === activeFolderId);

  const moduleCounts = folderList.reduce<Record<string, number>>((acc, f) => {
    acc[f.id] = modules.filter((m) => m.folder_id === f.id).length;
    return acc;
  }, {});

  const suggestions =
    SUGGESTED_PROMPTS[activeFolder?.folder_type ?? ""] ?? DEFAULT_PROMPTS;

  // ── AI Builder handlers ──

  function handleChip(text: string) {
    setPrompt(text);
    inputRef.current?.focus();
  }

  function handleBuildSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || isBuildPending || !activeFolder) return;
    setBuildError(null);

    startBuildTransition(async () => {
      const res = await buildModule(
        sandbox.id,
        activeFolderId,
        activeFolder.folder_type ?? "",
        trimmed,
      );
      if (!res.ok) { setBuildError(res.error); return; }
      setModules((prev) => [res.module, ...prev]);
      setPrompt("");
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleBuildSubmit();
    }
  }

  // ── Add Folder handler ──

  function handleAddFolder(name: string, folderType: string) {
    setFolderError(null);
    startAddTransition(async () => {
      const res = await addFolder(sandbox.id, name, folderType);
      if (!res.ok) { setFolderError(res.error); return; }
      const newFolder: SandboxFolder = {
        id: (res.folder as AddedFolder).id,
        name: (res.folder as AddedFolder).name,
        folder_type: (res.folder as AddedFolder).folder_type,
        position: (res.folder as AddedFolder).position,
      };
      setFolderList((prev) => [...prev, newFolder]);
      setActiveFolderId(newFolder.id);
      setShowAddFolder(false);
      setFolderError(null);
    });
  }

  const statusDot =
    sandbox.status === "active"
      ? "bg-emerald-500"
      : sandbox.status === "building"
        ? "bg-amber-500"
        : "bg-gray-400";

  const statusLabel =
    sandbox.status === "active"
      ? "Active"
      : sandbox.status === "building"
        ? "Building"
        : "Idle";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#070f1c] text-white">
      {/* Add Folder Modal */}
      <AnimatePresence>
        {showAddFolder && (
          <AddFolderModal
            onClose={() => { setShowAddFolder(false); setFolderError(null); }}
            onAdd={handleAddFolder}
            isPending={isAddPending}
            error={folderError}
          />
        )}
      </AnimatePresence>

      {/* ── Top bar ── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/8 bg-[#0a1628] px-4">
        <Link
          href="/sandbox"
          className="flex items-center gap-1 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
        >
          <IconChevronLeft className="h-4 w-4" />
        </Link>

        <div className="mx-1 h-5 w-px bg-white/10" />

        <h1 className="flex-1 truncate text-sm font-semibold text-white">
          {sandbox.title ?? "Untitled Sandbox"}
        </h1>

        <div className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1">
          <span className={`h-2 w-2 rounded-full ${statusDot}`} />
          <span className="text-xs text-white/60">{statusLabel}</span>
        </div>

        <div className="ml-2 flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {["JM", "LO"].map((ini) => (
              <span
                key={ini}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-[#0a1628] bg-[#c9a84c]/20 text-[10px] font-semibold text-[#c9a84c]"
              >
                {ini}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/8 hover:text-white/80"
          >
            <IconUsers className="h-3.5 w-3.5" />
            Permissions
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left folder sidebar ── */}
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/8 bg-[#0a1628]">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
              Folders
            </span>
            <button
              type="button"
              title="Add folder"
              onClick={() => setShowAddFolder(true)}
              className="flex h-5 w-5 items-center justify-center rounded text-white/30 transition-colors hover:bg-white/8 hover:text-white/70"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-4">
            {folderList.length === 0 && (
              <p className="px-2 pt-2 text-[12px] text-white/25">No folders yet</p>
            )}
            {folderList.map((folder) => {
              const active = folder.id === activeFolderId;
              const count = moduleCounts[folder.id] ?? 0;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setActiveFolderId(folder.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-all duration-150 ${
                    active
                      ? "border-l-2 border-[#c9a84c] bg-[#c9a84c]/8 pl-[10px] font-medium text-[#c9a84c]"
                      : "text-white/50 hover:bg-white/5 hover:text-white/80"
                  }`}
                >
                  <span className="truncate">{folder.name ?? "Untitled"}</span>
                  {count > 0 && (
                    <span
                      className={`ml-2 shrink-0 text-[11px] ${active ? "text-[#c9a84c]/70" : "text-white/25"}`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Main content ── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Module grid */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {activeFolder && (
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  {activeFolder.name ?? "Modules"}
                </h2>
                {visibleModules.length > 0 && (
                  <span className="text-[12px] text-white/30">
                    {visibleModules.length}{" "}
                    {visibleModules.length === 1 ? "module" : "modules"}
                  </span>
                )}
              </div>
            )}

            {visibleModules.length === 0 ? (
              <EmptyState folderName={activeFolder?.name ?? "This folder"} />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence initial={false}>
                  {visibleModules.map((mod) => (
                    <ModuleCard
                      key={mod.id}
                      mod={mod}
                      creatorName={creatorName}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* ── AI Builder bar ── */}
          <div className="shrink-0 border-t border-white/8 bg-[#0a1628] px-5 py-4">
            {/* Suggested chips */}
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleChip(s)}
                  disabled={isBuildPending}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white/50 transition-colors hover:border-[#c9a84c]/30 hover:bg-[#c9a84c]/8 hover:text-[#c9a84c] disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Input row */}
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center gap-2 text-[#c9a84c]">
                <IconSparkles className="h-4 w-4" />
                <span className="text-[13px] font-medium">AI Builder</span>
              </div>

              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isBuildPending || !activeFolder}
                  placeholder={
                    activeFolder
                      ? `Build something in ${activeFolder.name ?? "this folder"}... (Enter to build)`
                      : "Select a folder to start building"
                  }
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-[#c9a84c]/40 focus:bg-[#c9a84c]/5 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <button
                type="button"
                onClick={handleBuildSubmit}
                disabled={!prompt.trim() || isBuildPending || !activeFolder}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#c9a84c] text-[#070f1c] transition-all hover:bg-[#e0c060] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isBuildPending ? (
                  <IconLoader className="h-4 w-4 animate-spin" />
                ) : (
                  <IconSend className="h-4 w-4" />
                )}
              </button>
            </div>

            {buildError && (
              <p className="mt-2 text-[12px] text-rose-400">{buildError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
