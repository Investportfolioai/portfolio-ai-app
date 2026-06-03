"use client";

import { useActionState, useState, useTransition } from "react";
import { motion } from "motion/react";
import { login, requestPasswordReset, type LoginState } from "./actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "forgot">("signin");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-light.png" alt="Portfolio AI" className="max-h-10 max-w-full" />
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#12121a] p-6 shadow-2xl">
          {mode === "signin" ? (
            <SignInForm onForgot={() => setMode("forgot")} />
          ) : (
            <ForgotForm onBack={() => setMode("signin")} />
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/40">Portfolio AI</p>
      </div>
    </div>
  );
}

function SignInForm({ onForgot }: { onForgot: () => void }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  return (
    <>
      <h1 className="text-2xl text-white">Sign in</h1>
      <p className="mt-1 text-sm text-white/50">Access your deal pipeline.</p>
      <form action={action} className="mt-6 space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@investportfolio.ai" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" />
        {state?.error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">
            {state.error}
          </p>
        )}
        <motion.button
          type="submit"
          disabled={pending}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </motion.button>
      </form>
      <button
        type="button"
        onClick={onForgot}
        className="mt-4 w-full text-center text-xs text-white/50 hover:text-white"
      >
        Forgot password?
      </button>
    </>
  );
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await requestPasswordReset(email);
      if (!res.ok) {
        setError(res.error ?? "Could not send reset email.");
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div>
        <h1 className="text-2xl text-white">Check your email</h1>
        <p className="mt-2 text-sm text-white/60">
          If an account exists for {email}, a password-reset link is on its way.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 w-full rounded-full bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl text-white">Reset password</h1>
      <p className="mt-1 text-sm text-white/50">We&apos;ll email you a reset link.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-white/50">
            Email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@investportfolio.ai"
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
          disabled={pending}
          className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 w-full text-center text-xs text-white/50 hover:text-white"
      >
        Back to sign in
      </button>
    </>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-white/50">
        {label}
      </span>
      <input
        {...props}
        required
        className="w-full rounded-md border border-white/[0.08] bg-[#1a1a2e] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}
