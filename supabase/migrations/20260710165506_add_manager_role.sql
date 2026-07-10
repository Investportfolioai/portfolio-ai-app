-- Add 'manager' to public.user_role enum
-- Manager = full edit access (same as owner/partner) minus the Portfolio tab.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.user_role'::regtype
    AND enumlabel = 'manager'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'manager';
  END IF;
END$$;
