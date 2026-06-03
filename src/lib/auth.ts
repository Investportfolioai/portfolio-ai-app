import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

export interface SessionUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
  entity_name: string | null;
}

/**
 * Returns the authenticated user + their profile row, or null if not signed in.
 * `supabase.auth.getUser()` revalidates the JWT against Supabase (don't trust
 * `getSession()` alone on the server). Memoized per render pass.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Profile is RLS-protected; users can always read their own row.
  const { data: profile } = await supabase
    .from("users")
    .select("full_name, role, entity_name")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? null,
    full_name: profile?.full_name ?? null,
    role: (profile?.role as UserRole | undefined) ?? null,
    entity_name: profile?.entity_name ?? null,
  };
});
