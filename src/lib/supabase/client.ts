import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components ("use client").
 * Uses the public anon key — all access is governed by Postgres RLS.
 */
export function createClient() {
  // Strip ALL whitespace — env values were pasted line-wrapped and contain
  // internal newlines that break the auth header (.trim() only strips ends).
  const clean = (v: string | undefined) => (v ?? "").replace(/\s/g, "");
  return createBrowserClient(
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
