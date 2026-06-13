-- Add closing-cost fee columns and wholesaler name to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS tc_fee numeric DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS attorney_fee numeric DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pm_fee numeric DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS wholesaler_name text;
