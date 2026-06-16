-- ===========================================================================
-- Lending feature — Phase 2
--
-- Adds:
--   • 'tc' to public.user_role enum
--   • tc_tab_grants  — tab-level permission scoping per TC
--   • deal_tcs       — deal-level TC assignment (mirrors deal_kps)
--   • lending_checklist_items — per-deal, per-stage checklist
--   • lender_readiness_docs  — per-deal asset-type-aware doc set
--   • lender_ref_folders     — top-level owner-managed reference folders
--   • lender_reference_docs  — per-folder reference uploads
--   • addendum_drafts        — per-deal AI-drafted addendums
--
-- Seed data: 7-stage checklist items + Commercial/Residential doc sets.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend user_role enum
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.user_role'::regtype
      AND enumlabel = 'tc'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'tc';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. tc_tab_grants — which tabs a TC can see
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_tab_grants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tab        text NOT NULL CHECK (tab IN ('lending', 'documents')),
  granted_by uuid REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tc_id, tab)
);

CREATE INDEX IF NOT EXISTS tc_tab_grants_tc_id_idx ON public.tc_tab_grants (tc_id);

ALTER TABLE public.tc_tab_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tc_tab_grants_admin ON public.tc_tab_grants;
CREATE POLICY tc_tab_grants_admin ON public.tc_tab_grants
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

DROP POLICY IF EXISTS tc_tab_grants_self_select ON public.tc_tab_grants;
CREATE POLICY tc_tab_grants_self_select ON public.tc_tab_grants
  FOR SELECT
  USING (tc_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. deal_tcs — deal-level TC assignment (mirrors deal_kps)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_tcs (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  tc_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by  uuid REFERENCES public.users(id),
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, tc_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS deal_tcs_id_key ON public.deal_tcs(id);
CREATE INDEX IF NOT EXISTS deal_tcs_deal_id_idx ON public.deal_tcs (deal_id);
CREATE INDEX IF NOT EXISTS deal_tcs_tc_id_idx   ON public.deal_tcs (tc_id);

ALTER TABLE public.deal_tcs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_tcs_admin ON public.deal_tcs;
CREATE POLICY deal_tcs_admin ON public.deal_tcs
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

DROP POLICY IF EXISTS deal_tcs_self_select ON public.deal_tcs;
CREATE POLICY deal_tcs_self_select ON public.deal_tcs
  FOR SELECT
  USING (tc_id = auth.uid());

-- Extend deals RLS to include TCs assigned to the deal
DROP POLICY IF EXISTS deals_select ON public.deals;
CREATE POLICY deals_select ON public.deals
  FOR SELECT
  USING (
    public.is_owner_or_partner()
    OR owner_id = auth.uid()
    OR coowner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.deal_kps k
      WHERE k.deal_id = deals.id AND k.kp_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = deals.id AND t.tc_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. lending_checklist_items — per-deal, per-stage checklist rows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lending_checklist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  stage        text NOT NULL CHECK (stage IN (
                  'loi','purchase_contract','emd_setup',
                  'lender_submission','appraisal_insurance','clear_to_close','closed'
               )),
  position     int NOT NULL DEFAULT 0,
  item_text    text NOT NULL,
  completed    boolean NOT NULL DEFAULT false,
  completed_by uuid REFERENCES public.users(id),
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lending_checklist_deal_idx ON public.lending_checklist_items (deal_id);
CREATE INDEX IF NOT EXISTS lending_checklist_stage_idx ON public.lending_checklist_items (deal_id, stage);

ALTER TABLE public.lending_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lending_checklist_admin ON public.lending_checklist_items;
CREATE POLICY lending_checklist_admin ON public.lending_checklist_items
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

-- TCs with 'lending' tab grant + deal assignment can read and update
DROP POLICY IF EXISTS lending_checklist_tc_select ON public.lending_checklist_items;
CREATE POLICY lending_checklist_tc_select ON public.lending_checklist_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = lending_checklist_items.deal_id AND t.tc_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tc_tab_grants g
      WHERE g.tc_id = auth.uid() AND g.tab = 'lending'
    )
  );

DROP POLICY IF EXISTS lending_checklist_tc_update ON public.lending_checklist_items;
CREATE POLICY lending_checklist_tc_update ON public.lending_checklist_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = lending_checklist_items.deal_id AND t.tc_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tc_tab_grants g
      WHERE g.tc_id = auth.uid() AND g.tab = 'lending'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = lending_checklist_items.deal_id AND t.tc_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tc_tab_grants g
      WHERE g.tc_id = auth.uid() AND g.tab = 'lending'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. lender_readiness_docs — per-deal doc set
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lender_readiness_docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  doc_name    text NOT NULL,
  asset_class text NOT NULL CHECK (asset_class IN ('commercial', 'residential')),
  received    boolean NOT NULL DEFAULT false,
  received_at timestamptz,
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lender_readiness_docs_deal_idx ON public.lender_readiness_docs (deal_id);

ALTER TABLE public.lender_readiness_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lender_readiness_docs_admin ON public.lender_readiness_docs;
CREATE POLICY lender_readiness_docs_admin ON public.lender_readiness_docs
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

DROP POLICY IF EXISTS lender_readiness_tc_select ON public.lender_readiness_docs;
CREATE POLICY lender_readiness_tc_select ON public.lender_readiness_docs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = lender_readiness_docs.deal_id AND t.tc_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tc_tab_grants g
      WHERE g.tc_id = auth.uid() AND g.tab = 'lending'
    )
  );

DROP POLICY IF EXISTS lender_readiness_tc_update ON public.lender_readiness_docs;
CREATE POLICY lender_readiness_tc_update ON public.lender_readiness_docs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = lender_readiness_docs.deal_id AND t.tc_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tc_tab_grants g
      WHERE g.tc_id = auth.uid() AND g.tab = 'lending'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = lender_readiness_docs.deal_id AND t.tc_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tc_tab_grants g
      WHERE g.tc_id = auth.uid() AND g.tab = 'lending'
    )
  );

-- ---------------------------------------------------------------------------
-- 6. lender_ref_folders — reference doc folders (owner-managed, deal-agnostic)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lender_ref_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lender_ref_folders_owner_idx ON public.lender_ref_folders (owner_id);

ALTER TABLE public.lender_ref_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lender_ref_folders_admin ON public.lender_ref_folders;
CREATE POLICY lender_ref_folders_admin ON public.lender_ref_folders
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

-- ---------------------------------------------------------------------------
-- 7. lender_reference_docs — per-folder reference uploads (mirrors sandbox_modules)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lender_reference_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id    uuid NOT NULL REFERENCES public.lender_ref_folders(id) ON DELETE CASCADE,
  doc_name     text NOT NULL,
  storage_path text,
  tags         text[] NOT NULL DEFAULT '{}',
  uploaded_by  uuid REFERENCES public.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lender_reference_docs_folder_idx ON public.lender_reference_docs (folder_id);

ALTER TABLE public.lender_reference_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lender_reference_docs_admin ON public.lender_reference_docs;
CREATE POLICY lender_reference_docs_admin ON public.lender_reference_docs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.lender_ref_folders f
      WHERE f.id = lender_reference_docs.folder_id AND public.is_owner_or_partner()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.lender_ref_folders f
      WHERE f.id = lender_reference_docs.folder_id AND public.is_owner_or_partner()
    )
  );

-- ---------------------------------------------------------------------------
-- 8. addendum_drafts — per-deal AI-drafted addendums with versioning
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.addendum_drafts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  title        text,
  content      text NOT NULL DEFAULT '',
  prompt_used  text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','finalized')),
  version      int NOT NULL DEFAULT 1,
  docx_path    text,
  created_by   uuid REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS addendum_drafts_deal_idx ON public.addendum_drafts (deal_id);

ALTER TABLE public.addendum_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addendum_drafts_admin ON public.addendum_drafts;
CREATE POLICY addendum_drafts_admin ON public.addendum_drafts
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

DROP POLICY IF EXISTS addendum_drafts_tc_select ON public.addendum_drafts;
CREATE POLICY addendum_drafts_tc_select ON public.addendum_drafts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deal_tcs t
      WHERE t.deal_id = addendum_drafts.deal_id AND t.tc_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tc_tab_grants g
      WHERE g.tc_id = auth.uid() AND g.tab = 'lending'
    )
  );

-- ---------------------------------------------------------------------------
-- 9. Seed: lending stage checklist items
--    (stored as template rows with deal_id = NULL via a staging table)
--    We insert into a template table so new deals get seeded on demand.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lending_checklist_templates (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage     text NOT NULL,
  position  int NOT NULL DEFAULT 0,
  item_text text NOT NULL
);

-- Clear and re-seed idempotently
TRUNCATE public.lending_checklist_templates;

INSERT INTO public.lending_checklist_templates (stage, position, item_text) VALUES
-- LOI Stage
('loi', 1, 'Draft LOI'),
('loi', 2, 'Send LOI to seller / wholesaler'),
('loi', 3, 'Negotiate terms'),
('loi', 4, 'Get LOI signed by all parties'),

-- Purchase Contract
('purchase_contract', 1, 'Send PSA to seller'),
('purchase_contract', 2, 'Get PSA signed back matching LOI terms'),
('purchase_contract', 3, 'Mutual release agreement in place'),
('purchase_contract', 4, 'Security agreement executed'),
('purchase_contract', 5, 'Fully executed confirmation received'),
('purchase_contract', 6, 'Open escrow'),

-- EMD & Deal Setup
('emd_setup', 1, 'Assign Transaction Leader (TL)'),
('emd_setup', 2, 'Assign Key Principal (KP)'),
('emd_setup', 3, 'Wire earnest money deposit'),
('emd_setup', 4, 'Confirm EMD receipt'),
('emd_setup', 5, 'TL fund seasoning in progress'),
('emd_setup', 6, 'Pay transaction coordinator'),
('emd_setup', 7, 'Get assignment of contract from wholesaler'),
('emd_setup', 8, 'Request docs from title'),

-- Lender Submission
('lender_submission', 1, 'Send entity docs: Operating Agreement, Articles, EIN'),
('lender_submission', 2, 'Send Certificate of Good Standing'),
('lender_submission', 3, 'Send PSA addendum adding KP as signer'),
('lender_submission', 4, 'Send Credit Authorization Form'),
('lender_submission', 5, 'Send KP financial docs (W-2, tax returns, bank statements)'),
('lender_submission', 6, 'Send TL bank statements'),
('lender_submission', 7, 'Confirm lender received everything'),

-- Appraisal & Insurance
('appraisal_insurance', 1, 'Request appraisal link from lender (never order independently)'),
('appraisal_insurance', 2, 'Pay appraisal through lender portal'),
('appraisal_insurance', 3, 'Schedule appraisal appointment'),
('appraisal_insurance', 4, 'Review appraised value vs purchase price'),
('appraisal_insurance', 5, 'Flag if repairs needed before close'),
('appraisal_insurance', 6, 'Renegotiate if appraisal comes in low'),
('appraisal_insurance', 7, 'Monthly Proof of Funds (POF) refresh'),
('appraisal_insurance', 8, 'Secure insurance binder'),
('appraisal_insurance', 9, 'Determine if insurance pays at title or direct'),
('appraisal_insurance', 10, 'Review final closing statement balance'),

-- Clear to Close
('clear_to_close', 1, 'Get Clear to Close (CTC) in writing'),
('clear_to_close', 2, 'Confirm closing date with all parties'),
('clear_to_close', 3, 'Review final ALTA against underwriting model'),
('clear_to_close', 4, 'Verify seller wire instructions'),
('clear_to_close', 5, 'Confirm TL and lender wire timing'),
('clear_to_close', 6, 'KP signs loan docs'),
('clear_to_close', 7, 'Leg 1 closes (DSCR loan + TL fund together)'),
('clear_to_close', 8, 'Confirm wires landed'),
('clear_to_close', 9, 'Leg 2: holdback to second attorney'),
('clear_to_close', 10, 'Attorney distributes to TL / seller DP / Gator / fees'),
('clear_to_close', 11, 'Confirm buyer net walk'),

-- Closed
('closed', 1, 'Deed recorded'),
('closed', 2, 'Collect all closing docs'),
('closed', 3, 'Set up seller carry payment'),
('closed', 4, 'Log balloon due date'),
('closed', 5, 'Onboard property management'),
('closed', 6, 'Set up dedicated bank account'),
('closed', 7, 'Send KP onboarding packet'),
('closed', 8, 'Schedule 90-day credit review'),
('closed', 9, 'Log deal into portfolio'),
('closed', 10, 'Auto-update KP SREO');

-- ---------------------------------------------------------------------------
-- 10. Seed: lender readiness doc templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lender_readiness_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class text NOT NULL CHECK (asset_class IN ('commercial', 'residential')),
  position    int NOT NULL DEFAULT 0,
  doc_name    text NOT NULL
);

TRUNCATE public.lender_readiness_templates;

INSERT INTO public.lender_readiness_templates (asset_class, position, doc_name) VALUES
-- Commercial
('commercial',  1, 'Purchase Contract'),
('commercial',  2, 'Operating Agreement'),
('commercial',  3, 'Certificate of Good Standing'),
('commercial',  4, 'Articles of Incorporation'),
('commercial',  5, 'EIN'),
('commercial',  6, 'Personal Financial Statement'),
('commercial',  7, 'SREO'),
('commercial',  8, 'Credit Authorization'),
('commercial',  9, 'Rent Roll'),
('commercial', 10, 'T-12 P&L'),
('commercial', 11, 'YTD P&L'),
('commercial', 12, '2023 P&L'),
('commercial', 13, '2024 P&L'),
('commercial', 14, '2025 P&L'),
('commercial', 15, '12-Month Occupancy Report'),
('commercial', 16, 'Recent CapEx'),
('commercial', 17, 'Recent Photos'),
('commercial', 18, 'Management Company Name'),

-- Residential
('residential',  1, 'Purchase Contract'),
('residential',  2, 'Operating Agreement'),
('residential',  3, 'Certificate of Good Standing'),
('residential',  4, 'Articles of Incorporation'),
('residential',  5, 'EIN'),
('residential',  6, 'Personal Financial Statement'),
('residential',  7, 'SREO'),
('residential',  8, 'Credit Authorization'),
('residential',  9, 'T-12'),
('residential', 10, 'Pro-Forma Rent'),
('residential', 11, 'Current Rent'),
('residential', 12, 'Value Add Analysis');

-- RLS: templates are readable by all authenticated users (used by server actions)
ALTER TABLE public.lending_checklist_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lending_checklist_templates_read ON public.lending_checklist_templates;
CREATE POLICY lending_checklist_templates_read ON public.lending_checklist_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

ALTER TABLE public.lender_readiness_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lender_readiness_templates_read ON public.lender_readiness_templates;
CREATE POLICY lender_readiness_templates_read ON public.lender_readiness_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);
