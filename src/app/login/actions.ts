"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string } | undefined;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // Surface a misconfigured environment instead of failing silently — a missing
  // or wrong NEXT_PUBLIC_SUPABASE_URL/ANON_KEY otherwise looks like a bad password.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { error: "Auth is not configured (missing Supabase URL/anon key)." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("login failed:", error.status, error.message);
    // Real bad-credentials → friendly message; anything else (bad API key,
    // wrong project, network) is surfaced so prod misconfig is diagnosable.
    return {
      error: /invalid login credentials/i.test(error.message)
        ? "Invalid email or password."
        : `Sign-in failed: ${error.message}`,
    };
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
