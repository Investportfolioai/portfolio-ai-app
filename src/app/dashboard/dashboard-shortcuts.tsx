"use client";

import { ShortcutsPanel, type ShortcutEntry } from "./shortcuts-panel";

const DASHBOARD_SHORTCUTS: ShortcutEntry[] = [
  { tokens: ["g", "p"], sep: "→", desc: "Pipeline", group: "Go to" },
  { tokens: ["g", "u"], sep: "→", desc: "Underwriting", group: "Go to" },
  { tokens: ["g", "o"], sep: "→", desc: "Portfolio", group: "Go to" },
];

export function DashboardShortcuts() {
  return <ShortcutsPanel shortcuts={DASHBOARD_SHORTCUTS} />;
}
