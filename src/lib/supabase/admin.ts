import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. BYPASSES RLS — never import this into a
 * Client Component or expose its results without your own authorization
 * checks. Use only for trusted server work (AI underwriting, seeding,
 * cross-tenant admin tasks).
 */
/**
 * Strip ALL whitespace from a credential. The env values were pasted into
 * Vercel line-wrapped, so they contain newlines *inside* the token (not just
 * trailing) — which throw "invalid header value" when the SDK sets the auth
 * header. JWTs/API keys never contain whitespace, so removing it is safe and
 * rejoins the wrapped token.
 */
const cleanKey = (v: string | undefined) => (v ?? "").replace(/\s/g, "");

export function createAdminClient() {
  return createClient(
    cleanKey(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
