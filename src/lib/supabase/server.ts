import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use in Server Components, Route Handlers, and Server Actions.
 *
 * Next.js 16 note: `cookies()` is async, so this factory is async too — always
 * `await createClient()`. Reads are scoped to the signed-in user's session and
 * enforced by Postgres RLS (owner/partner see all, kp/viewer see their deals).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` was called from a Server Component, where cookies are
            // read-only. Session refresh is handled in proxy.ts instead, so
            // this can be safely ignored.
          }
        },
      },
    },
  );
}
