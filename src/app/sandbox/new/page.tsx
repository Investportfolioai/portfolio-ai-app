"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSandbox } from "../actions";

const TEMPLATES = [
  { key: "Curative Title",       desc: "Track title defects and remediation",     color: "#60a5fa" },
  { key: "Wholesale Pipeline",   desc: "End-to-end wholesale deal flow",          color: "#a78bfa" },
  { key: "Creative Finance",     desc: "Morby Method and seller carry deals",     color: "#C9A84C" },
  { key: "Content Strategy",     desc: "Marketing and content planning",          color: "#22d3ee" },
  { key: "Multifamily Strategy", desc: "Multi-unit acquisition pipeline",         color: "#fb923c" },
  { key: "Business Acquisition", desc: "Business purchase and integration",       color: "#818cf8" },
  { key: "Blank",                desc: "Start from scratch",                      color: "rgba(255,255,255,0.3)" },
];

const TITLE_DEFAULTS: Record<string, string> = {
  "Curative Title":       "Title Cure Pipeline",
  "Wholesale Pipeline":   "Wholesale Outreach System",
  "Creative Finance":     "Creative Finance Playbook",
  "Content Strategy":     `Content Strategy — Q${Math.ceil((new Date().getMonth() + 1) / 3)}`,
  "Multifamily Strategy": "Multifamily Acquisition Strategy",
  "Business Acquisition": "Business Acquisition Pipeline",
  "Blank":                "",
};

const TEMPLATE_BG: Record<string, string> = {
  "Curative Title":       "rgba(59,130,246,0.12)",
  "Wholesale Pipeline":   "rgba(139,92,246,0.12)",
  "Creative Finance":     "rgba(201,168,76,0.12)",
  "Content Strategy":     "rgba(6,182,212,0.12)",
  "Multifamily Strategy": "rgba(249,115,22,0.12)",
  "Business Acquisition": "rgba(99,102,241,0.12)",
  "Blank":                "rgba(255,255,255,0.06)",
};

export default function NewSandboxPage() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [template, setTemplate] = useState("Blank");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function selectTemplate(key: string) {
    setTemplate(key);
    setTitle(TITLE_DEFAULTS[key] ?? "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createSandbox({ title, description, template });
      if (!res.ok) { setError(res.error); return; }
      router.push(`/sandbox/${res.id}`);
    });
  }

  return (
    <div style={{ background: "#0A0B14", minHeight: "100vh", padding: "40px 24px" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto" }}>

        {/* Back */}
        <button
          type="button"
          onClick={() => router.push("/sandbox")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#6b7280", fontSize: "13px", display: "flex", alignItems: "center",
            gap: "6px", marginBottom: "32px", padding: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "white"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#6b7280"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back to Sandboxes
        </button>

        <h1 style={{ color: "white", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "6px" }}>
          New Sandbox
        </h1>
        <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "32px" }}>
          Choose a template to get started, then customize your workspace.
        </p>

        <form onSubmit={handleSubmit}>
          {/* Template picker */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{
              display: "block", fontSize: "10px", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.1em",
              color: "rgba(255,255,255,0.3)", marginBottom: "12px",
            }}>
              Template
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
              {TEMPLATES.map((t) => {
                const selected = template === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => selectTemplate(t.key)}
                    style={{
                      background: selected ? "rgba(201,168,76,0.08)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${selected ? "rgba(201,168,76,0.5)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: "12px",
                      padding: "12px",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 150ms ease",
                      boxShadow: selected ? "0 0 0 1px rgba(201,168,76,0.2)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) {
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) {
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                      }
                    }}
                  >
                    <span style={{
                      display: "inline-block",
                      background: TEMPLATE_BG[t.key],
                      color: t.color,
                      borderRadius: "999px",
                      padding: "2px 8px",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      marginBottom: "6px",
                    }}>
                      {t.key}
                    </span>
                    <p style={{
                      color: selected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.3)",
                      fontSize: "11px", lineHeight: "1.4", margin: 0,
                    }}>
                      {t.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{
              display: "block", fontSize: "10px", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.1em",
              color: "rgba(255,255,255,0.3)", marginBottom: "8px",
            }}>
              Title *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Q3 Wholesale Push"
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px",
                padding: "10px 14px", fontSize: "14px", color: "white",
                outline: "none", boxSizing: "border-box",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#C9A84C";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(201,168,76,0.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{
              display: "block", fontSize: "10px", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.1em",
              color: "rgba(255,255,255,0.3)", marginBottom: "8px",
            }}>
              What are you building?
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe your strategy or goal…"
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px",
                padding: "10px 14px", fontSize: "14px", color: "white",
                outline: "none", resize: "none", boxSizing: "border-box",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
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

          {error && (
            <div style={{
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "10px", padding: "10px 14px",
              color: "#f87171", fontSize: "13px", marginBottom: "16px",
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              onClick={() => router.push("/sandbox")}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px", padding: "10px 20px", fontSize: "14px",
                color: "rgba(255,255,255,0.5)", cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              style={{
                background: "#C9A84C", border: "none", borderRadius: "10px",
                padding: "10px 24px", fontSize: "14px", fontWeight: 600,
                color: "#0A0B14", cursor: pending ? "not-allowed" : "pointer",
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? "Creating…" : "Create Sandbox"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
