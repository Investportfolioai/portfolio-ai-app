-- ===========================================================================
-- Nightly digest state (Automation Push, section 7).
--
-- Single-row tracker of the last time the nightly overview digest ran, so the
-- "since last digest" sections (auto-applied changes, etc.) have a precise
-- window rather than a fixed 24h guess. Written only by the service-role admin
-- client at the end of each digest run.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- Verify with:  select id, last_digest_at from public.digest_state;
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.digest_state (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_digest_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Seed one row stamped now(), so the first digest's window is bounded (not all-time).
INSERT INTO public.digest_state (id, last_digest_at) VALUES (1, now())
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.digest_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digest_state_read ON public.digest_state;
CREATE POLICY digest_state_read ON public.digest_state FOR SELECT USING (public.is_deal_manager());
-- Writes happen only via the service-role admin client (no write policy).
