-- Add 'seller_finance' to the deal_structure enum.
-- ALTER TYPE ... ADD VALUE can't run inside a transaction block; run this
-- statement on its own in the Supabase SQL editor.

ALTER TYPE deal_structure ADD VALUE IF NOT EXISTS 'seller_finance';
