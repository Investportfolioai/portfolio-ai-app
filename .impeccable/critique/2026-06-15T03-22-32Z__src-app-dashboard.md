---
target: dashboard
total_score: 27
p0_count: 0
p1_count: 0
p2_count: 3
timestamp: 2026-06-15T03-22-32Z
slug: src-app-dashboard
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading states (opacity + "—"), undo toast, error toast — minor gap: no global last-refreshed indicator |
| 2 | Match System / Real World | 3 | "Cashback Rate" fixed; pipeline language is RE-natural; ACQ/STAB are domain-appropriate abbreviations |
| 3 | User Control and Freedom | 3 | Undo toast, Escape closes panel, focus restoration, range toggles — no undo for deal deletion |
| 4 | Consistency and Standards | 3 | Typography tokens consistent; KpiRow + AchievementStat now match; glass-card survives in 3 AchievementBoard sub-panels vs flat everywhere else |
| 5 | Error Prevention | 3 | type="number" inputs, auto-save with undo, error rollback on network failure |
| 6 | Recognition Rather Than Recall | 3 | Options visible, filter tabs labeled, status badges on cards, IntelligenceBar labels now 11px |
| 7 | Flexibility and Efficiency | 2 | DealCard keyboard access added; Escape works; no shortcuts, no bulk actions, no power-user path |
| 8 | Aesthetic and Minimalist Design | 3 | Hero-metric template gone from both rows; no side-stripes, no gradient text; 3 residual glass-card panels in AchievementBoard create noise vs flat system |
| 9 | Error Recovery | 3 | Plain-language error toasts, UI rollback on failure, 5s undo window |
| 10 | Help and Documentation | 1 | No tooltips, no contextual help; ACQ/STAB/Buybox unexplained; grade thresholds (A>=90, B>=80) invisible to users |
| **Total** | | **27/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment**: The dashboard no longer reads as AI-generated. The PipelineStatus typeset opening beat is distinctive. KpiRow and AchievementStat both use the clean flat panel pattern. The primary remaining tell is the three glass-card panels inside AchievementBoard (leaderboard, trend chart, deal mix) — they visually pop above the flat system in a way that reads as "default card style, not changed."

**Deterministic scan**: [] — zero findings. Clean run. No side-stripes, no gradient text, no hero-metric template detected.

## Overall Impression

The dashboard has meaningfully leveled up this session — all three P2s fixed, detector clean, the flat design system is now cohesive through the operational layer. The remaining friction is in the AchievementBoard section: three glass-card panels that haven't been flattened, and a "Buybox" label in IntelligenceBar that contradicts the "Cashback Rate" label in the KPI row for the same metric. Help and documentation is the lone structural weak spot.

## What's Working

1. **PipelineStatus as opening beat.** Numbers-as-links typeset in mono/body pairing with dot separators. The most authored element on the page.
2. **Undo toast on auto-save.** Capturing prevNum before the async, 5s undo window with real re-PATCH. Correct financial-data behavior.
3. **KpiRow + AchievementStat unified pattern.** Both stat rows use the same flat rgba(26,29,39,0.7) panel, label-card / num-metric / 1px dividers. Coherent visual language.

## Priority Issues

**[P2] "Buybox" vs "Cashback Rate" name collision**
- What: KPI row says "Cashback Rate." IntelligenceBar MiniStat (pipeline-board.tsx:166) says "Buybox." Both display buybox_score — same metric, two names.
- Why it matters: A user seeing 12% under two different labels has to figure out if they're the same number or different.
- Fix: Change label="Buybox" to label="Cashback Rate" on MiniStat at pipeline-board.tsx:166.
- Suggested command: /impeccable polish

**[P2] AchievementBoard glass-card inconsistency**
- What: Three glass-card panels remain in AchievementBoard — leaderboard, chart, deal mix. Rest of dashboard is flat.
- Why it matters: Glass on 3 containers while everything else is flat implies visual tier that isn't earned. Leftover, not a choice.
- Fix: Convert three AchievementBoard sub-panels to flat inline styles: background rgba(26,29,39,0.85), border 1px solid rgba(255,255,255,0.06), borderRadius 12px.
- Suggested command: /impeccable polish

**[P2] No contextual help for grade abbreviations**
- What: GradePill shows "ACQ A" and "STAB B" with no tooltip. Thresholds (A>=90, B>=80, C>=70, D>=60) are in code but invisible to users.
- Why it matters: Grades drive underwriting decisions. Users interpreting grades they don't understand is a trust risk.
- Fix: Add title attribute to GradePill as minimum. Better: hover tooltip.
- Suggested command: /impeccable harden

## Persona Red Flags

**Alex (Power User)**: DealCard keyboard access fixed. No shortcut to filter pipeline by status. No batch cashback update. Range toggle requires mouse. No cross-section keyboard navigation.

**Sam (Accessibility)**: DealCard ARIA complete. DealPanel role=dialog + aria-modal + focus management. Remaining: GradePill no aria-label beyond visual abbreviation. Color carries semantic weight (green/amber) without non-color signal on grade pills. AchievementStat dividers visual-only.

## Minor Observations

- XAxis tick fontSize: 9 in trend chart (achievement-board.tsx:381) — below 11px floor
- "Live" badge on AchievementBoard is mislabeled — data is historical/aggregated, not a live feed
- label-eyebrow on "12-Week Trend" and "Deal Mix" — panel-internal, not page-section ban violation
