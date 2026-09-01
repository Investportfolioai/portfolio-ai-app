-- ===========================================================================
-- EMD morning follow-up cancellation (Automation Push, section 3 addendum).
--
-- Stores the Resend message id of the scheduled 8am "final window" email so a
-- later hard-date change can cancel the pending send before it goes out stale
-- (see updateDealField in pipeline/actions.ts and the reminder sweep in
-- api/cron/emd-reminders/route.ts).
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- Verify with:
--   select column_name from information_schema.columns
--   where table_name = 'deals' and column_name = 'emd_morning_email_id';
-- ===========================================================================

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_morning_email_id text;
