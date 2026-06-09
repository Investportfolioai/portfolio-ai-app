-- Phase 3 — Portfolio: holdings table + deal escrow/cashback columns.
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).

CREATE TABLE IF NOT EXISTS holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES users(id),
  address text NOT NULL,
  property_type text,
  purchase_price numeric,
  acquisition_date date,
  mortgage_balance numeric,
  monthly_payment numeric,
  zillow_avm numeric,
  zillow_last_pulled timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS cashback_at_close numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS escrow_date timestamptz;

ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners can manage holdings" ON holdings;
CREATE POLICY "owners can manage holdings" ON holdings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner','partner'))
  );
