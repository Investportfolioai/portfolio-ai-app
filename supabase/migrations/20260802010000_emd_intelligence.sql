-- ===========================================================================
-- EMD intelligence — Phase 1 (schema).
--
-- Adds EMD tracking fields to deals (amount, hard date, extension count,
-- notes, appraisal-received timestamp, and per-reminder sent stamps so each
-- reminder fires exactly once) plus a new emd_events audit log table
-- (reminders sent, extensions granted, hard-date changes, appraisal alerts).
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- deals — EMD fields.
-- ---------------------------------------------------------------------------
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_amount numeric;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_hard_date date;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_extension_count int NOT NULL DEFAULT 0;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_notes text;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS appraisal_received_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_reminder_7_sent_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_reminder_4_sent_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_appraisal_reminder_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- emd_events — audit log (reminders sent, extensions, date changes, alerts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.emd_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN (
                'reminder_7', 'reminder_4', 'appraisal_alert',
                'extension_granted', 'went_hard', 'date_changed'
              )),
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS emd_events_deal_idx ON public.emd_events (deal_id);

ALTER TABLE public.emd_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emd_events_rw ON public.emd_events;
CREATE POLICY emd_events_rw ON public.emd_events FOR ALL
  USING (public.is_deal_manager()) WITH CHECK (public.is_deal_manager());
