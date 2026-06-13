/**
 * One-time migration: add tc_fee, attorney_fee, pm_fee, wholesaler_name to deals.
 * Run with: npx tsx src/lib/migrations/add-fee-columns.ts
 * The canonical SQL lives in supabase/migrations/20260613010021_add_fee_columns.sql
 * and is applied to remote via: npx supabase db push
 */
import "dotenv/config";
import { createAdminClient } from "@/lib/supabase/admin";

const SQL = `
ALTER TABLE deals ADD COLUMN IF NOT EXISTS tc_fee numeric DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS attorney_fee numeric DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pm_fee numeric DEFAULT 0;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS wholesaler_name text;
`;

async function run() {
  const admin = createAdminClient();
  const { error } = await admin.rpc("exec_sql", { sql: SQL });
  if (error) {
    console.error("Migration failed:", error.message);
    process.exit(1);
  }
  console.log("Migration applied successfully.");
}

run();
