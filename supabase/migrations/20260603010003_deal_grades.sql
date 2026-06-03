-- ===========================================================================
-- Underwriting score columns on deals: acquisition_grade + stabilization_grade.
-- Integers 0–100, nullable. NULL renders as "—" on the deal cards.
-- Apply via `supabase db push` or the Supabase SQL editor.
-- ===========================================================================

alter table public.deals
  add column if not exists acquisition_grade integer
    check (acquisition_grade between 0 and 100),
  add column if not exists stabilization_grade integer
    check (stabilization_grade between 0 and 100);
