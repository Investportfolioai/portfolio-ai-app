---
target: dashboard
total_score: 26
p0_count: 0
p1_count: 0
p2_count: 3
p3_count: 2
timestamp: 2026-06-15T03-08-15Z
slug: src-app-dashboard
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Save feedback works; DashboardIntel still has no skeleton on client-side fetch |
| 2 | Match System / Real World | 3 | "Buybox Score" label contradicts "avg cashback at close" sub-text |
| 3 | User Control and Freedom | 3 | Undo toast solid; "Mark Closed" still irreversible |
| 4 | Consistency and Standards | 3 | Side-stripe gone, font/gold unified. Buybox label mismatch prevents 4 |
| 5 | Error Prevention | 2 | Blur-save still fires; undo is recovery not prevention |
| 6 | Recognition Rather Than Recall | 3 | IntelligenceBar collapse state resets every session |
| 7 | Flexibility and Efficiency | 2 | Keyboard nav: Escape only. DealCard not keyboard-focusable |
| 8 | Aesthetic and Minimalist Design | 3 | Above-fold clean. AchievementBoard hero-metric below fold |
| 9 | Error Recovery | 3 | Network failures surface, undo available |
| 10 | Help and Documentation | 1 | 9px labels, no contextual help |
| **Total** | | **26/40** | **Acceptable — above-fold solid, known targets remain** |

## Anti-Patterns Verdict

Detector: [] — clean for second consecutive run. No findings. Previous borderLeft: '3px solid' violation gone. LLM: above-fold clean (PipelineStatus → flat KPI → flat panels). AchievementBoard below fold still matches hero-metric template. No new violations introduced.

## Priority Issues

### [P2] Buybox Score / avg cashback label contradiction
dashboard-intel.tsx KpiStat. Label "Buybox Score" contradicts sub "avg cashback at close". Two definitions for one number. Fix: pick one definition, remove the other.

### [P2] AchievementBoard hero-metric template
achievement-board.tsx MetricCard. Icon + num-hero + gold underline + label-card, 4-up grid. Fix: horizontal stats row like KPI refactor.

### [P2] 9px IntelligenceBar labels
pipeline-board.tsx line 177. text-[9px] on MiniStat labels. WCAG 1.4.4 failure. Fix: text-[11px] minimum.

### [P3] Escrow vs active cards visually identical post-stripe removal
Both show "Active" StatusBadge. No upfront escrow signal. Fix: add "In Escrow" pill or faint gold tint to escrow cards.

### [P3] DealCard not keyboard-focusable
motion.div with onClick, no tabIndex/role/keyboard handler. Keyboard users cannot open deal panels. Fix: render as button or add tabIndex={0} + onKeyDown Enter handler.

## Persona Red Flags

Alex: count-up on every load (noise for repeat users), DealCard not keyboard-accessible, IntelligenceBar collapse not persisted.

Sam: DealCard keyboard access none, 9px MiniStat labels WCAG violation, IntelligenceBar toggle missing aria-expanded/aria-controls.

The Operator: Dashboard IA now correct. Buybox label mismatch affects daily decision quality. Escrow card visual signal gone post-stripe. Cashback input has no editability affordance.
