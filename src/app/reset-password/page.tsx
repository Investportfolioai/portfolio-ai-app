"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, start] = useTransition();

  // Exchange the reset link's code for a (recovery) session on load.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      // No code — either an old hash-style link the client already handled, or invalid.
      setReady(true);
      return;
    }
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) setLinkError(true);
        setReady(true);
      })
      .catch(() => {
        setLinkError(true);
        setReady(true);
      });
  }, [supabase]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    start(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-light.png" alt="Portfolio AI" className="max-h-10 max-w-full" />
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-[#12121a] p-6 shadow-2xl">
          {!ready ? (
            <p className="text-sm text-white/60">Verifying your reset link…</p>
          ) : done ? (
            <div>
              <h1 className="text-2xl text-white">Password updated</h1>
              <p className="mt-2 text-sm text-white/60">Redirecting to sign in…</p>
            </div>
          ) : linkError ? (
            <div>
              <h1 className="text-2xl text-white">Link expired</h1>
              <p className="mt-2 text-sm text-white/60">
                This reset link is invalid or has expired. Request a new one from the login page.
              </p>
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="mt-6 w-full rounded-full bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl text-white">Set a new password</h1>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-white/50">
                    New password
                  </span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-md border border-white/[0.08] bg-[#1a1a2e] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
