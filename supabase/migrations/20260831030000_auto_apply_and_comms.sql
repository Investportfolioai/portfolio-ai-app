-- ===========================================================================
-- Automation Push — blocks 4/5/6 (auto-apply tier + sent-mail awareness).
--
-- deal_updates gains document provenance (doc_type + document_date) so the
-- review queue can show "addendum dated X supersedes contract dated Y" on a
-- one-tap conflict, plus a 'cleared' status + resolved_ref for waiting-on
-- markers (section 5) that resolve when a matching inbound/doc arrives.
--
-- gmail_processed_comms: a SEPARATE dedupe ledger for the sent/inbound
-- communication scan, so it never collides with the attachment-scan ledger
-- (gmail_processed_messages) — a message filed by one scan must remain
-- eligible for the other. Service-role only, like the existing ledger.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- Verify with:
--   select column_name from information_schema.columns
--   where table_name = 'deal_updates'
--     and column_name in ('document_date','doc_type','resolved_ref');
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'deal_updates_status_check';
--   select to_regclass('public.gmail_processed_comms');
-- ===========================================================================

-- Section 4: document-hierarchy provenance on proposed/applied updates.
ALTER TABLE public.deal_updates ADD COLUMN IF NOT EXISTS document_date date;
ALTER TABLE public.deal_updates ADD COLUMN IF NOT EXISTS doc_type text;

-- Section 5: waiting-on resolution — add 'cleared' status + what resolved it.
ALTER TABLE public.deal_updates DROP CONSTRAINT IF EXISTS deal_updates_status_check;
ALTER TABLE public.deal_updates ADD CONSTRAINT deal_updates_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'auto', 'cleared'));
ALTER TABLE public.deal_updates ADD COLUMN IF NOT EXISTS resolved_ref text;

-- Section 5: dedupe ledger for the sent/inbound communication scan.
CREATE TABLE IF NOT EXISTS public.gmail_processed_comms (
  message_id   text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now(),
  deal_id      uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  direction    text CHECK (direction IN ('sent', 'inbound'))
);

ALTER TABLE public.gmail_processed_comms ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all for anon/authenticated; only the service-role admin
-- client (which bypasses RLS) reads or writes this table.
