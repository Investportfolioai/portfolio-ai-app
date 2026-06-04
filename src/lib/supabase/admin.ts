import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. BYPASSES RLS — never import this into a
 * Client Component or expose its results without your own authorization
 * checks. Use only for trusted server work (AI underwriting, seeding,
 * cross-tenant admin tasks).
 */
export function createAdminClient() {
  // .trim() guards against a trailing newline in the env value — an untrimmed
  // key throws "invalid header value" when the SDK sets the auth header.
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
