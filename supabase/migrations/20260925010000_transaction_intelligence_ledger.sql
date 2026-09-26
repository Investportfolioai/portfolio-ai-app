-- ===========================================================================
-- Transaction Intelligence — Phase G, Section 1 (schema).
--
-- deals gains four fields for the everything-update digest: emd_received_at
-- (mirrors the existing appraisal_received_at pattern — set once, cleared
-- only by an explicit edit), entity_name (vesting LLC, editable via the
-- Overview tab EditableRow — Section 3), appraised_value and
-- appraisal_conditions (subject-to conditions list) so the digest can render
-- turnkey/subject-to status and compute the 32% POF requirement (Section 2d).
--
-- deal_expected_items is a per-deal ledger of expected/requested/received
-- items (title commitment, survey, EMD receipt, insurance, appraisal, POF
-- submission, clear-to-close, +rent_roll/t12 for commercial) — seeded from a
-- code-side template (BASE_EXPECTED_ITEMS, Section 1c) and advanced by the
-- Gmail scans (Section 2) or manually in the Ledger UI (Section 3).
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- Verify with:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_name = 'deals'
--     and column_name in ('emd_received_at','entity_name','appraised_value','appraisal_conditions')
--   order by column_name;
--
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_name = 'deal_expected_items'
--   order by ordinal_position;
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.deal_expected_items'::regclass;
--
--   select indexname, indexdef from pg_indexes where tablename = 'deal_expected_items';
--
--   select polname, permissive, roles, cmd, qual, with_check
--   from pg_policies where tablename = 'deal_expected_items';
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- deals — everything-update fields.
-- ---------------------------------------------------------------------------
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS emd_received_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS entity_name text;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS appraised_value numeric;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS appraisal_conditions jsonb;

-- ---------------------------------------------------------------------------
-- deal_expected_items — per-deal document/task ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_expected_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  item_key      text NOT NULL,
  label         text NOT NULL,
  owner_party   text NOT NULL CHECK (owner_party IN (
                  'agent', 'tc', 'lender', 'title', 'buyer', 'seller', 'internal', 'other'
                )),
  status        text NOT NULL DEFAULT 'expected' CHECK (status IN (
                  'expected', 'requested', 'received', 'cleared', 'waived'
                )),
  source        text,
  evidence_ref  text,
  requested_at  timestamptz,
  received_at   timestamptz,
  cleared_at    timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, item_key)
);

CREATE INDEX IF NOT EXISTS deal_expected_items_deal_idx ON public.deal_expected_items (deal_id);
CREATE INDEX IF NOT EXISTS deal_expected_items_deal_status_idx ON public.deal_expected_items (deal_id, status);

ALTER TABLE public.deal_expected_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_expected_items_rw ON public.deal_expected_items;
CREATE POLICY deal_expected_items_rw ON public.deal_expected_items FOR ALL
  USING (public.is_deal_manager()) WITH CHECK (public.is_deal_manager());
