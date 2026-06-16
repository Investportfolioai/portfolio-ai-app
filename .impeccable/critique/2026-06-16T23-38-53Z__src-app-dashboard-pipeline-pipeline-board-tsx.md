---
target: pipeline
total_score: 29
p0_count: 0
p1_count: 0
timestamp: 2026-06-16T23-38-53Z
slug: src-app-dashboard-pipeline-pipeline-board-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Escrow/Pending are explicit states now; no tooltip context on new pill (fixed) |
| 2 | Match System / Real World | 4 | "Escrow" is precise real-estate domain language; improvement over "Active" |
| 3 | User Control and Freedom | 3 | n/a for display component; board-level controls intact |
| 4 | Consistency and Standards | 3 | Pill style matches GradePill exactly; intentional divergence from StatusBadge dot |
| 5 | Error Prevention | 3 | Display-only; no error path |
| 6 | Recognition Rather Than Recall | 3 | Labels self-explanatory; title/aria-label added to match GradePill pattern |
| 7 | Flexibility and Efficiency | 2 | Pre-existing keyboard shortcuts from prior hardening pass |
| 8 | Aesthetic and Minimalist Design | 3 | Clean; monospace tint pill unifies visually with grade pills |
| 9 | Error Recovery | 3 | n/a |
| 10 | Help and Documentation | 2 | No contextual tooltip (fixed: title+aria-label added) |
| **Total** | | **29/40** | **Good** |

## Anti-Patterns Verdict

**LLM assessment**: No AI slop. The pill borrows style DNA verbatim from GradePill — monospace font, 0.04em tracking, 999px radius, 2px 8px padding, rgba tint + solid text. No gradient, no glow, no dot, no uppercase. Semantic distinction (Escrow vs Pending) is domain-specific and meaningful. Fallback chain (StatusBadge for dead/passed/closed) correctly preserved.

**Deterministic scan**: detect.mjs returned [] — zero hits. Clean.

## Overall Impression

Surgical and correct change. One P3 gap found and fixed: DealCardStatusPill now has title and aria-label matching GradePill pattern.

## What's Working

1. Perfect style inheritance — no approximation, no invented values. Pill reads as native member of the grade pill system.
2. Semantic precision — "Escrow" replaces "Active" with a meaningful phase label real estate professionals recognize immediately.
3. Clean fallback — terminal states (dead/passed/closed) continue using StatusBadge unchanged.

## Priority Issues

**[P3] Missing title/aria-label on DealCardStatusPill** — FIXED
- GradePill sets title and aria-label for tooltip context and screen reader annotation. DealCardStatusPill now matches.
- Fix applied: Added title="Status: In escrow" aria-label="Status: Escrow" and title="Status: Pending" aria-label="Status: Pending".

## Persona Red Flags

**Alex (Power User)**: No issues. Display-only.

**Sam (Accessibility)**: DealCardStatusPill now has aria-label matching GradePill pattern in the same grades row. Fixed.

## Minor Observations

None.

## Questions to Consider

- Should "Escrow" show the escrow date inline (e.g. "Escrow · Jun 30") for quick scanning without opening the panel?
