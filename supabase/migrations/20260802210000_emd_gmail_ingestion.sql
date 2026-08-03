-- ===========================================================================
-- EMD intelligence — Phase 2 (Gmail ingestion, storage-only — no Drive).
--
-- gmail_processed_messages: dedupe ledger so /api/cron/gmail-scan never
-- double-processes the same message. Cron-only bookkeeping — RLS enabled
-- with no policies, reachable only via the service-role admin client.
--
-- emd_extraction_staging: one row per matched attachment (audit trail of
-- what was extracted and what happened to it) or per unmatched/ambiguous
-- message (backlog for manual review). Manager-readable like emd_events/
-- deal_documents, even though no UI reads it yet in this phase.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.gmail_processed_messages (
  message_id   text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now(),
  deal_id      uuid REFERENCES public.deals(id) ON DELETE SET NULL
);

ALTER TABLE public.gmail_processed_messages ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all for anon/authenticated; only the service-role
-- admin client (which bypasses RLS) can read or write this table.

CREATE TABLE IF NOT EXISTS public.emd_extraction_staging (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id    text NOT NULL REFERENCES public.gmail_processed_messages(message_id) ON DELETE CASCADE,
  deal_id             uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  deal_document_id    uuid REFERENCES public.deal_documents(id) ON DELETE SET NULL,
  attachment_filename text,
  match_method        text NOT NULL CHECK (match_method IN ('matched', 'unmatched', 'ambiguous')),
  match_detail        text,
  extracted           jsonb,
  applied_fields       jsonb,
  conflict_fields      jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS emd_extraction_staging_deal_idx ON public.emd_extraction_staging (deal_id);

ALTER TABLE public.emd_extraction_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emd_extraction_staging_rw ON public.emd_extraction_staging;
CREATE POLICY emd_extraction_staging_rw ON public.emd_extraction_staging FOR ALL
  USING (public.is_deal_manager()) WITH CHECK (public.is_deal_manager());
