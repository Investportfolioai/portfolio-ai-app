"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type Phase = "loading" | "ready" | "done" | "error";

export default function TcSetupPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<Phase>("loading");
  const [linkError, setLinkError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, start] = useTransition();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    if (accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) {
            setLinkError("This invite link has expired or already been used. Ask to be re-invited.");
            setPhase("error");
          } else {
            window.history.replaceState(null, "", window.location.pathname);
            setPhase("ready");
          }
        });
      return;
    }

    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) {
            setLinkError("This invite link has expired or already been used. Ask to be re-invited.");
            setPhase("error");
          } else {
            window.history.replaceState(null, "", window.location.pathname);
            setPhase("ready");
          }
        });
      return;
    }

    setLinkError("No invite token found. Use the link from your invite email.");
    setPhase("error");
  }, [supabase]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      return;
    }
    setFormError("");
    start(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(error.message);
        return;
      }
      setPhase("done");
      setTimeout(() => router.push("/tc/dashboard"), 1200);
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1c3f] px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 px-8 py-10 backdrop-blur">
        <Image
          src="/logo-light.png"
          alt="Portfolio AI"
          width={150}
          height={40}
          className="mx-auto mb-8 h-9 w-auto"
          priority
        />

        {phase === "loading" && (
          <p className="text-center text-sm text-white/60">Verifying your invite…</p>
        )}

        {phase === "error" && (
          <div className="text-center">
            <h1 className="text-xl font-medium text-white">Link issue</h1>
            <p className="mt-2 text-sm text-white/60">{linkError}</p>
          </div>
        )}

        {phase === "ready" && (
          <>
            <h1 className="mb-1 text-center text-xl font-medium text-white">Set your password</h1>
            <p className="mb-6 text-center text-sm text-white/60">
              Choose a password to finish setting up your Portfolio AI account.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/50">
                  Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Min 8 characters"
                  className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/50">
                  Confirm password
                </span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                />
              </label>
              {formError && (
                <p className="rounded-lg bg-rose-500/20 px-3 py-2 text-sm text-rose-300">
                  {formError}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#0f1c3f] hover:bg-white/90 disabled:opacity-60"
              >
                {saving ? "Setting up…" : "Set password & continue"}
              </button>
            </form>
          </>
        )}

        {phase === "done" && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-xl font-medium text-white">You&apos;re all set</h1>
            <p className="mt-2 text-sm text-white/60">Taking you to your dashboard…</p>
          </div>
        )}
      </div>
    </main>
  );
}
