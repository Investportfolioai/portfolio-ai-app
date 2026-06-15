"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type ShortcutEntry = {
  tokens: string[];
  sep?: "/" | "→";
  desc: string;
  group: string;
};

const NAV_SHORTCUTS: ShortcutEntry[] = [
  { tokens: ["g", "p"], sep: "→", desc: "Pipeline", group: "Go to" },
  { tokens: ["g", "u"], sep: "→", desc: "Underwriting", group: "Go to" },
  { tokens: ["g", "o"], sep: "→", desc: "Portfolio", group: "Go to" },
  { tokens: ["?"], desc: "Toggle shortcuts", group: "Go to" },
];

export function ShortcutsPanel({ shortcuts = [] }: { shortcuts?: ShortcutEntry[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const openRef = useRef(false);
  const gPendingRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout>>(null!);

  openRef.current = open;

  const allShortcuts = [...shortcuts, ...NAV_SHORTCUTS];
  const groups = allShortcuts.reduce<Record<string, ShortcutEntry[]>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const inInput =
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA" ||
        (e.target as HTMLElement).isContentEditable;

      // Esc closes the panel
      if (e.key === "Escape") {
        if (openRef.current) {
          setOpen(false);
          // consume the event so other handlers don't also fire
          e.stopImmediatePropagation();
        }
        return;
      }

      // ? toggles panel (not in inputs)
      if (e.key === "?" && !inInput) {
        setOpen((v) => !v);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      // When panel is open, eat all other keys
      if (openRef.current) {
        e.stopImmediatePropagation();
        return;
      }

      if (inInput) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // g + key navigation sequence
      if (gPendingRef.current) {
        gPendingRef.current = false;
        clearTimeout(gTimerRef.current);
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === "p") router.push("/dashboard/pipeline");
        else if (e.key === "u") router.push("/dashboard/underwriting");
        else if (e.key === "o") router.push("/dashboard/portfolio");
        return;
      }

      if (e.key === "g") {
        gPendingRef.current = true;
        // eat g so it doesn't trigger anything else
        e.stopImmediatePropagation();
        gTimerRef.current = setTimeout(() => {
          gPendingRef.current = false;
        }, 1000);
      }
    }

    // capture: true fires before bubble-phase handlers (PipelineBoard's handler)
    // so we can intercept g-sequences before they reach page-specific handlers
    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      clearTimeout(gTimerRef.current);
    };
  }, [router]);

  return (
    <>
      {/* Floating ? button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        title="Keyboard shortcuts (?)"
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 50,
          width: "32px",
          height: "32px",
          borderRadius: "9999px",
          background: "rgba(26,29,39,0.92)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.38)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          transition: "border-color 150ms ease, color 150ms ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(201,168,76,0.5)";
          (e.currentTarget as HTMLButtonElement).style.color = "#C9A84C";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
          (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.38)";
        }}
      >
        ?
      </button>

      {/* Backdrop */}
      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 51,
            background: "rgba(0,0,0,0.3)",
          }}
        />
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          tabIndex={-1}
          style={{
            position: "fixed",
            bottom: "68px",
            right: "24px",
            zIndex: 52,
            width: "288px",
            maxHeight: "calc(100vh - 100px)",
            overflowY: "auto",
            background: "rgba(10,11,20,0.97)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            padding: "18px 20px 14px",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 24px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
            animation: "fadeUp 0.15s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <span style={{
              fontFamily: "var(--font-body), sans-serif",
              fontSize: "10px", fontWeight: 600,
              letterSpacing: "0.1em", textTransform: "uppercase",
              color: "rgba(255,255,255,0.3)",
            }}>
              Keyboard Shortcuts
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close shortcuts"
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.28)", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "0 2px", display: "flex", alignItems: "center" }}
            >
              ×
            </button>
          </div>

          {/* Groups */}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div style={{
                  fontSize: "9px", fontWeight: 600,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "rgba(255,255,255,0.18)", marginBottom: "6px",
                }}>
                  {group}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  {items.map((s) => (
                    <div key={s.desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "3px 0" }}>
                      <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", flexShrink: 1 }}>
                        {s.desc}
                      </span>
                      <Keys tokens={s.tokens} sep={s.sep} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: "6px", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.18)" }}>Press</span>
            <Kbd>?</Kbd>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.18)" }}>or</span>
            <Kbd>Esc</Kbd>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.18)" }}>to close</span>
          </div>
        </div>
      )}
    </>
  );
}

function Keys({ tokens, sep = "/" }: { tokens: string[]; sep?: "/" | "→" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
      {tokens.map((t, i) => (
        <span key={t + i} style={{ display: "contents" }}>
          {i > 0 && (
            <span style={{ color: "rgba(255,255,255,0.22)", fontSize: "10px", margin: "0 1px" }}>
              {sep}
            </span>
          )}
          <Kbd>{t}</Kbd>
        </span>
      ))}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono)", fontSize: "11px",
      background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.65)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "4px", padding: "1px 6px", minWidth: "22px",
      lineHeight: 1.5,
    }}>
      {children}
    </kbd>
  );
}
