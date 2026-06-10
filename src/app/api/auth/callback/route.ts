import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Supabase PKCE auth callback. Exchanges the one-time `code` param for a
 * session, then routes the user to the right dashboard based on their role.
 * KP / viewer invite links redirect here after the user clicks the email CTA.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const role = data.user.user_metadata?.role as string | undefined;
      const dest =
        role === "kp" || role === "viewer" ? "/kp/dashboard" : "/dashboard";
      return NextResponse.redirect(new URL(dest, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=invite_expired", origin));
}
