-- Phase 3 upgrade — document parsing, balloon tracker, financials, snapshots.
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).

CREATE TABLE IF NOT EXISTS holding_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id uuid REFERENCES holdings(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text,
  doc_type text, -- 'closing', 'mortgage', 'seller_note', 'lease', 'other'
  parsed_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holding_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id uuid REFERENCES holdings(id) ON DELETE CASCADE,
  avm_value numeric,
  snapshot_date date DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holding_financials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id uuid REFERENCES holdings(id) ON DELETE CASCADE,
  outflow_mortgage numeric DEFAULT 0,
  outflow_seller_carry numeric DEFAULT 0,
  outflow_taxes numeric DEFAULT 0,
  outflow_hoa numeric DEFAULT 0,
  outflow_other numeric DEFAULT 0,
  income_rent numeric DEFAULT 0,
  income_other numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE holdings ADD COLUMN IF NOT EXISTS balloon_date date;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS balloon_notes text;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS extension_clause text;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS seller_carry_balance numeric;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS seller_carry_payment numeric;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS seller_carry_maturity date;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS purchase_close_price numeric;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS important_notes text;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS lease_end_date date;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS tenant_name text;

ALTER TABLE holding_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE holding_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE holding_financials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners manage holding_documents" ON holding_documents;
CREATE POLICY "owners manage holding_documents" ON holding_documents FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner','partner')));
DROP POLICY IF EXISTS "owners manage holding_snapshots" ON holding_snapshots;
CREATE POLICY "owners manage holding_snapshots" ON holding_snapshots FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner','partner')));
DROP POLICY IF EXISTS "owners manage holding_financials" ON holding_financials;
CREATE POLICY "owners manage holding_financials" ON holding_financials FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner','partner')));
