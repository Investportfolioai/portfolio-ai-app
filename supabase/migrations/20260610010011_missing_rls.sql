-- ===========================================================================
-- RLS for lenders + deal_milestones (neither was in prior migrations).
-- KP documents storage bucket with folder-scoped upload policies.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- lenders — contact directory, readable by all authenticated users, writable
-- only by owner/partner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lenders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text,
  rate        numeric,
  max_ltv     numeric,
  contact_name text,
  phone       text,
  email       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.lenders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lenders_select ON public.lenders;
CREATE POLICY lenders_select ON public.lenders
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS lenders_admin_write ON public.lenders;
CREATE POLICY lenders_admin_write ON public.lenders
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

-- ---------------------------------------------------------------------------
-- deal_milestones — owner/partner full access; KPs may read milestones on
-- deals they are assigned to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  label          text NOT NULL,
  target_date    date NOT NULL,
  milestone_type text NOT NULL DEFAULT 'custom',
  source         text NOT NULL DEFAULT 'manual',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_milestones_deal_id_idx ON public.deal_milestones(deal_id);

ALTER TABLE public.deal_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS milestones_admin_rw ON public.deal_milestones;
CREATE POLICY milestones_admin_rw ON public.deal_milestones
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());

DROP POLICY IF EXISTS milestones_kp_select ON public.deal_milestones;
CREATE POLICY milestones_kp_select ON public.deal_milestones
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deal_kps k
      WHERE k.deal_id = deal_milestones.deal_id AND k.kp_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- kp-documents storage bucket — KPs upload to their own uid/ prefix;
-- owner/partner can read and manage everything.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('kp-documents', 'kp-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Drop any stale policies before recreating.
DROP POLICY IF EXISTS "kp_upload_own_folder"        ON storage.objects;
DROP POLICY IF EXISTS "kp_read_own_docs"             ON storage.objects;
DROP POLICY IF EXISTS "owner_partner_manage_kp_docs" ON storage.objects;

-- KPs: INSERT into their own folder only (path format: <kp_id>/filename).
CREATE POLICY "kp_upload_own_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kp-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('kp', 'viewer')
    )
  );

-- KPs: SELECT their own folder.
CREATE POLICY "kp_read_own_docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kp-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner/partner: full control over everything in the bucket.
CREATE POLICY "owner_partner_manage_kp_docs" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'kp-documents'
    AND public.is_owner_or_partner()
  )
  WITH CHECK (
    bucket_id = 'kp-documents'
    AND public.is_owner_or_partner()
  );

-- ---------------------------------------------------------------------------
-- Magic link / invite OTP expiry — set to 1 hour (3600 seconds).
-- Run this in the Supabase SQL editor if the dashboard value differs.
-- Navigate to: Authentication > URL Configuration > Email OTP Expiry (seconds).
-- Target value: 3600
--
-- Supabase does not expose this via SQL; confirm in the Auth dashboard panel.
-- ---------------------------------------------------------------------------
