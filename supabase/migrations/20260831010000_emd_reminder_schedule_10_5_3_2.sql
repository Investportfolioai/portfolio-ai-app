-- ===========================================================================
-- EMD reminder schedule → 10 / 5 / 3 / 2 days (Automation Push, section 2).
--
-- Adds per-threshold idempotency stamps for the new schedule. The legacy
-- 7/4-day columns (emd_reminder_7_sent_at, emd_reminder_4_sent_at) are kept
-- for historical rows but are no longer written by the reminder sweep.
--
-- Also extends the emd_events event_type check to cover the new reminder types
-- plus reminder_1_morning (the section-3 8am follow-up), added now so section 3
-- needs no second constraint migration. Legacy reminder_7/reminder_4 values are
-- retained so existing audit rows still satisfy the constraint.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- Verify with:
--   select column_name from information_schema.columns
--   where table_name = 'deals' and column_name like 'emd_reminder_%_sent_at';
-- ===========================================================================

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_reminder_10_sent_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_reminder_5_sent_at  timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_reminder_3_sent_at  timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_reminder_2_sent_at  timestamptz;

ALTER TABLE public.emd_events DROP CONSTRAINT IF EXISTS emd_events_event_type_check;
ALTER TABLE public.emd_events ADD CONSTRAINT emd_events_event_type_check CHECK (event_type IN (
  'reminder_10', 'reminder_5', 'reminder_3', 'reminder_2', 'reminder_1_morning',
  'reminder_7', 'reminder_4',                        -- legacy, retained for history
  'appraisal_alert', 'extension_granted', 'went_hard', 'date_changed'
));
