-- ===========================================================================
-- Deal Intelligence Engine — Phase A (approval queue foundation).
--
-- deal_updates: every AI/email/note-derived proposed change lands here as
-- 'pending' first — nothing writes to a live deal field without a human
-- tapping Approve (server-side, via the existing updateDealField whitelist,
-- never a raw UPDATE). event_type/source both closed CHECK enums; extend the
-- CHECK constraint in a future migration if a new value is ever needed.
--
-- deal_notes: structured, multi-row notes (replaces nothing — sits alongside
-- the existing deals.notes freetext scratch field). Trusted users (owner/
-- partner/manager) get full read/write; KPs may insert only on deals they're
-- assigned to (mirrors the deal_kps assignment-check subquery already used
-- for deals_select RLS) and may only see their own notes.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.deal_updates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  source            text NOT NULL CHECK (source IN ('email', 'note', 'appraisal_report', 'system')),
  source_ref        text,
  author_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type        text NOT NULL CHECK (event_type IN (
                      'communication', 'doc_received', 'status_change', 'milestone',
                      'emd_change', 'appraisal_result', 'extension', 'task', 'other'
                    )),
  summary           text NOT NULL,
  proposed_changes  jsonb,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'auto')),
  reviewed_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_updates_deal_status_idx ON public.deal_updates (deal_id, status);

ALTER TABLE public.deal_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_updates_rw ON public.deal_updates;
CREATE POLICY deal_updates_rw ON public.deal_updates FOR ALL
  USING (public.is_deal_manager()) WITH CHECK (public.is_deal_manager());

-- ---------------------------------------------------------------------------
-- deal_notes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.deal_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  ai_processed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_notes_deal_idx ON public.deal_notes (deal_id);

ALTER TABLE public.deal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_notes_manager_all ON public.deal_notes;
CREATE POLICY deal_notes_manager_all ON public.deal_notes FOR ALL
  USING (public.is_deal_manager()) WITH CHECK (public.is_deal_manager());

-- KP: may insert a note, only as themselves, only on a deal they're assigned to.
DROP POLICY IF EXISTS deal_notes_kp_insert ON public.deal_notes;
CREATE POLICY deal_notes_kp_insert ON public.deal_notes FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.deal_kps k
      WHERE k.deal_id = deal_notes.deal_id AND k.kp_id = auth.uid()
    )
  );

-- KP: may only see their own notes (not the full deal's note history).
DROP POLICY IF EXISTS deal_notes_kp_select ON public.deal_notes;
CREATE POLICY deal_notes_kp_select ON public.deal_notes FOR SELECT
  USING (author_id = auth.uid());
