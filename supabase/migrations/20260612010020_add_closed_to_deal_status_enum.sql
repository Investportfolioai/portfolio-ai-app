-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Run this directly in the Supabase SQL editor, or via `supabase db push`
-- (Supabase CLI runs non-transactional DDL outside the transaction automatically).
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'dead';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'closed';
