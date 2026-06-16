---
target: dashboard
total_score: 26
p0_count: 0
p1_count: 1
p2_count: 4
timestamp: 2026-06-15T02-57-30Z
slug: src-app-dashboard
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Cashback save now surfaces feedback; skeleton states still absent on DashboardIntel load |
| 2 | Match System / Real World | 3 | "Buybox Score" label contradicts "avg cashback at close" sub-text |
| 3 | User Control and Freedom | 3 | Undo toast is a major gain; "Mark Closed" has no undo |
| 4 | Consistency and Standards | 3 | Font and gold token fixed. Side-stripe deal cards still violate house rules |
| 5 | Error Prevention | 2 | Blur-save still fires silently; undo is recovery, not prevention |
| 6 | Recognition Rather Than Recall | 3 | Grade pills consistent. Collapse state not persisted. No grade tooltips |
| 7 | Flexibility and Efficiency | 2 | Escape-only keyboard support. No bulk actions |
| 8 | Aesthetic and Minimalist Design | 3 | Above-fold decluttered. Glassmorphism still default for all panels |
| 9 | Error Recovery | 3 | Network failure now shows toast.error + UI rollback. No document retry |
| 10 | Help and Documentation | 1 | No contextual help, no grade tooltips, 9px IntelligenceBar labels |
| **Total** | | **26/40** | **Acceptable — meaningful progress, clear next targets** |

## Anti-Patterns Verdict

**LLM assessment:** Dashboard is noticeably less AI-template on first load. PipelineStatus reads as a deliberate product decision. KPI panel is cleaner than four glass cards. Typography identity (Cormorant Garamond + DM Sans) is now actually visible. Remaining tell: deal card side-stripe (3px colored left border as primary status signal). Glassmorphism still applied indiscriminately to pipeline panels and Quick Links.

**Deterministic scan:** 1 finding (was 3). `borderLeft: '3px solid'` at pipeline-board.tsx line 772. Previous two findings (bounce easing, sidebar width transition) gone — both fixed. Detector and LLM agree; no false positives.

## Priority Issues

### [P1] Side-stripe deal cards
pipeline-board.tsx line 772. `borderLeft: '3px solid ${leftBorder}'` as primary status signal. Banned pattern. Fix: remove borderLeft, let StatusBadge carry signal, use full-card background tint if grouping needed.

### [P2] "Buybox Score" / "avg cashback at close" contradiction
dashboard-intel.tsx KpiStat. Label says "Buybox Score", sub says "avg cashback at close". Two different metrics, one number. Fix: pick one definition, eliminate the other.

### [P2] AchievementBoard: hero-metric template (below fold)
achievement-board.tsx MetricCard. Icon + num-hero + gold underline + label-card. Banned template. Now below fold so severity reduced.

### [P2] Glassmorphism squatting on flat containers
dashboard-intel.tsx Panel (line 239) + page.tsx QuickLink (line 65). glass-card with backdrop-filter: blur(12px) on siblings with no depth reason. Fix: flat dark background + 1px border.

### [P2] 9px IntelligenceBar labels
pipeline-board.tsx line 177. WCAG 1.4.4 failure. Fix: text-[11px] minimum.

## Persona Red Flags

**Alex (Power User):** Count-up fires every load (10+ times/day for operator). No keyboard shortcuts beyond Escape. IntelligenceBar collapse state not persisted. No bulk cashback edit.

**Sam (Accessibility):** StatusBadge/GradeBadge color-only. 9px MiniStat labels. Deal card left border is color-only status for screen readers.

**The Operator:** Now lands on pipeline status (fixed). "Buybox Score" vs "avg cashback" label mismatch causes decision uncertainty. Cashback input has no affordance signaling editability.
