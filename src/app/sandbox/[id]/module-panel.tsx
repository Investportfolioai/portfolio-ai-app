"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { X, Sparkles, Send, Loader2, Plus, Copy } from "lucide-react";
import type { ContentBlock } from "./actions";
import { updateModuleContent, editModuleWithAI, fetchModuleContent } from "./actions";

// ---------------------------------------------------------------------------
// Markdown stripper — cleans AI-generated text/script blocks before display
// ---------------------------------------------------------------------------

function stripMarkdown(value: string): string {
  return value
    .replace(/^#{1,3}\s+/gm, "")         // ### headings
    .replace(/\*\*(.+?)\*\*/g, "$1")     // **bold**
    .replace(/\*(.+?)\*/g, "$1")         // *italic*
    .replace(/^--+\s*/gm, "")            // -- list markers
    .replace(/^>\s*/gm, "")              // > blockquotes
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // [link](url) → link text
    .trim();
}

function stripBlocksMarkdown(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((b) =>
    b.type === "text" || b.type === "script"
      ? { ...b, value: stripMarkdown(b.value) }
      : b,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PanelModule {
  id: string;
  title: string | null;
  status: string;
  folder_type: string | null;
  content: ContentBlock[] | null;
}

// ---------------------------------------------------------------------------
// AI edit suggested chips per folder type
// ---------------------------------------------------------------------------

const EDIT_SUGGESTIONS: Record<string, [string, string, string]> = {
  deals: ["Make it more aggressive", "Add a KP qualifier step", "Shorten to key points"],
  title_cure: ["Add heir outreach steps", "Make checklist more detailed", "Add timeline estimates"],
  cold_call: ["Add objection handlers", "Make the opener stronger", "Add a closing sequence"],
  content: ["Add hooks for each point", "Rewrite for Instagram", "Add a CTA to each section"],
  documents: ["Make it more formal", "Add signature blocks", "Shorten to one page"],
  follow_up: ["Add urgency to step 3", "Extend to 7 steps", "Make tone more personal"],
};
const DEFAULT_EDIT_SUGGESTIONS: [string, string, string] = [
  "Make it more detailed",
  "Shorten to key points",
  "Add examples",
];

// ---------------------------------------------------------------------------
// Block type config
// ---------------------------------------------------------------------------

const BLOCK_CONFIG: Record<string, { label: string; color: string }> = {
  checklist: { label: "Checklist", color: "text-emerald-400" },
  script:    { label: "Script",    color: "text-blue-400"    },
  sequence:  { label: "Sequence",  color: "text-violet-400"  },
  text:      { label: "Text",      color: "text-white/40"    },
};

// ---------------------------------------------------------------------------
// Auto-resize textarea
// ---------------------------------------------------------------------------

function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={{ resize: "none", overflow: "hidden", minHeight: "72px" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Block editors
// ---------------------------------------------------------------------------

function ChecklistEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const items = value ? value.split("\n") : [""];

  function update(i: number, text: string) {
    const next = [...items];
    next[i] = text;
    onChange(next.join("\n"));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = [...items];
      next.splice(i + 1, 0, "");
      onChange(next.join("\n"));
    } else if (e.key === "Backspace" && items[i] === "" && items.length > 1) {
      e.preventDefault();
      const next = items.filter((_, idx) => idx !== i);
      onChange(next.join("\n"));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <div className="mt-px h-3.5 w-3.5 shrink-0 rounded border border-white/20" />
          <input
            type="text"
            value={item}
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            placeholder="Checklist item..."
            className="flex-1 bg-transparent text-[13px] text-white/80 placeholder-white/20 outline-none"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""].join("\n"))}
        className="mt-1 flex items-center gap-1 pl-6 text-[12px] text-white/25 transition-colors hover:text-[#c9a84c]"
      >
        <Plus className="h-3 w-3" />
        Add item
      </button>
    </div>
  );
}

function SequenceEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const items = value ? value.split("\n") : [""];

  function update(i: number, text: string) {
    const next = [...items];
    next[i] = text;
    onChange(next.join("\n"));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = [...items];
      next.splice(i + 1, 0, "");
      onChange(next.join("\n"));
    } else if (e.key === "Backspace" && items[i] === "" && items.length > 1) {
      e.preventDefault();
      const next = items.filter((_, idx) => idx !== i);
      onChange(next.join("\n"));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <span className="mt-0.5 min-w-[20px] shrink-0 text-[11px] font-semibold tabular-nums text-white/25">
            {String(i + 1).padStart(2, "0")}.
          </span>
          <input
            type="text"
            value={item}
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            placeholder={`Step ${i + 1}...`}
            className="flex-1 bg-transparent text-[13px] text-white/80 placeholder-white/20 outline-none"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""].join("\n"))}
        className="mt-1 flex items-center gap-1 pl-7 text-[12px] text-white/25 transition-colors hover:text-[#c9a84c]"
      >
        <Plus className="h-3 w-3" />
        Add step
      </button>
    </div>
  );
}

function TextareaEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <AutoTextarea
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? "Enter content..."}
      className="w-full bg-transparent text-[13px] leading-relaxed text-white/80 placeholder-white/20 outline-none"
    />
  );
}

function BlockEditor({
  block,
  onChange,
}: {
  block: ContentBlock;
  onChange: (value: string) => void;
}) {
  switch (block.type) {
    case "checklist":
      return <ChecklistEditor value={block.value} onChange={onChange} />;
    case "sequence":
      return <SequenceEditor value={block.value} onChange={onChange} />;
    case "script":
      return <TextareaEditor value={block.value} onChange={onChange} placeholder="Script content..." />;
    case "text":
    default:
      return (
        <TextareaEditor
          value={block.value.replace(/\\n/g, "\n").replace(/\\t/g, "\t")}
          onChange={onChange}
          placeholder="Text content..."
        />
      );
  }
}

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
// ModulePanel
// ---------------------------------------------------------------------------

export function ModulePanel({
  module,
  onClose,
  onUpdate,
}: {
  module: PanelModule;
  onClose: () => void;
  onUpdate: (id: string, updates: { title?: string; content?: ContentBlock[] }) => void;
}) {
  const [title, setTitle] = useState(module.title ?? "");
  const [content, setContent] = useState<ContentBlock[]>(module.content ?? []);
  const [editPrompt, setEditPrompt] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [promptHistory, setPromptHistory] = useState<{ text: string; ts: Date }[]>([]);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If content is null on open, fetch fresh from DB immediately
  useEffect(() => {
    if (module.content !== null && module.content !== undefined) return;
    let active = true;
    fetchModuleContent(module.id).then((fresh) => {
      if (!active || !fresh || fresh.length === 0) return;
      const cleaned = stripBlocksMarkdown(fresh);
      setContent(cleaned);
      contentRef.current = cleaned;
      onUpdate(module.id, { content: cleaned });
    }).catch(() => { /* ignore */ });
    return () => { active = false; };
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep refs current for debounce closures
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  titleRef.current = title;
  contentRef.current = content;

  // Debounce auto-save (single shared timer for any field change)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateModuleContent(
        module.id,
        contentRef.current,
        titleRef.current,
      ).catch(console.error);
    }, 800);
  }

  // Reset state when a different module is selected
  useEffect(() => {
    setTitle(module.title ?? "");
    setContent(module.content ?? []);
    setEditPrompt("");
    setEditError(null);
    setPromptHistory([]);
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll every 3s when content is empty, stop once content arrives
  useEffect(() => {
    if (content.length > 0) {
      setIsPolling(false);
      return;
    }
    setIsPolling(true);
    let active = true;
    const timer = setInterval(async () => {
      try {
        const fresh = await fetchModuleContent(module.id);
        if (!active) return;
        if (fresh && fresh.length > 0) {
          const cleaned = stripBlocksMarkdown(fresh);
          setContent(cleaned);
          contentRef.current = cleaned;
          onUpdate(module.id, { content: cleaned });
          setIsPolling(false);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [module.id, content.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleCopyForSheets() {
    const val = content[0].value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    navigator.clipboard.writeText(val).catch(console.error);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopied(true);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  function handleTitleChange(val: string) {
    setTitle(val);
    onUpdate(module.id, { title: val });
    scheduleSave();
  }

  function handleBlockChange(i: number, value: string) {
    const next = content.map((b, idx) => (idx === i ? { ...b, value } : b));
    setContent(next);
    onUpdate(module.id, { content: next });
    scheduleSave();
  }

  async function handleAiEdit() {
    const trimmed = editPrompt.trim();
    if (!trimmed || isAiLoading) return;
    setEditError(null);
    setIsAiLoading(true);
    setPromptHistory((prev) => {
      const next = [{ text: trimmed, ts: new Date() }, ...prev].slice(0, 3);
      return next;
    });
    try {
      const res = await editModuleWithAI(module.id, contentRef.current, trimmed);
      if (!res.ok) {
        toast.error("Edit failed");
        setEditError(res.error ?? "AI edit failed");
        return;
      }
      const cleaned = stripBlocksMarkdown(res.content ?? []);
      setContent(cleaned);
      contentRef.current = cleaned;
      onUpdate(module.id, { content: cleaned });
      setEditPrompt("");
      toast.success("Updated");
    } catch {
      toast.error("Edit failed");
    } finally {
      setIsAiLoading(false);
    }
  }

  function handleAiKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAiEdit();
    }
  }

  const suggestions =
    EDIT_SUGGESTIONS[module.folder_type ?? ""] ?? DEFAULT_EDIT_SUGGESTIONS;

  const cfg = BLOCK_CONFIG;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-white/10 bg-[#0d1b30] shadow-2xl"
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-start gap-3 border-b border-white/8 px-5 py-4">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Module title"
              className="w-full bg-transparent text-base font-semibold text-white placeholder-white/25 outline-none"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            <StatusBadge status={module.status} />
            {content.length === 1 && content[0].type === "text" && (
              <button
                type="button"
                onClick={handleCopyForSheets}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] text-white/40 transition-colors hover:border-[#c9a84c]/30 hover:text-[#c9a84c]"
              >
                <Copy className="h-3 w-3" />
                {copied ? "Copied!" : "Copy for Sheets"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-white/30 transition-colors hover:bg-white/8 hover:text-white/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {content.length === 0 && (
            <div className="flex items-center gap-2 text-[13px] text-white/30">
              {isPolling ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  <span>AI is generating content…</span>
                </>
              ) : (
                <span>No content yet. Use the AI edit bar below.</span>
              )}
            </div>
          )}
          <div className="flex flex-col gap-5">
            {content.map((block, i) => {
              const blockCfg = cfg[block.type] ?? cfg.text;
              return (
                <div key={i} className="rounded-xl border border-white/8 bg-[#0a1628] p-4">
                  <span
                    className={`mb-3 block text-[10px] font-semibold uppercase tracking-widest ${blockCfg.color}`}
                  >
                    {blockCfg.label}
                  </span>
                  <BlockEditor
                    block={block}
                    onChange={(value) => handleBlockChange(i, value)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* ── AI edit bar ── */}
        <div className="shrink-0 border-t border-white/8 bg-[#0a1628] px-5 py-4">
          {/* Prompt history */}
          {promptHistory.length > 0 && (
            <div className="mb-3 flex flex-col gap-1">
              {promptHistory.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-white/30">
                  <span className="shrink-0 tabular-nums">
                    {h.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="truncate">{h.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Chips */}
          <div className="mb-3 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setEditPrompt(s)}
                disabled={isAiLoading}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white/50 transition-colors hover:border-[#c9a84c]/30 hover:bg-[#c9a84c]/8 hover:text-[#c9a84c] disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input row */}
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 items-center gap-2 text-[#c9a84c]">
              <Sparkles className="h-4 w-4" />
              <span className="text-[13px] font-medium">Ask AI to edit...</span>
            </div>

            <input
              type="text"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              onKeyDown={handleAiKeyDown}
              disabled={isAiLoading}
              placeholder="Give an edit instruction..."
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-[#c9a84c]/40 focus:bg-[#c9a84c]/5 disabled:cursor-not-allowed disabled:opacity-50"
            />

            <button
              type="button"
              onClick={handleAiEdit}
              disabled={!editPrompt.trim() || isAiLoading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#c9a84c] text-[#070f1c] transition-all hover:bg-[#e0c060] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isAiLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>

          {isAiLoading && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#c9a84c]/70">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI is thinking…
            </p>
          )}
          {editError && !isAiLoading && (
            <p className="mt-2 text-[12px] text-rose-400">{editError}</p>
          )}
        </div>
      </motion.div>
    </>
  );
}
