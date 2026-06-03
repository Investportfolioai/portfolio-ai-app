"use client";

import { useActionState } from "react";
import { motion } from "motion/react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined,
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Portfolio AI" className="max-h-10 max-w-full" />
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#12121a] p-6 shadow-2xl">
          <h1 className="text-2xl text-white">Sign in</h1>
          <p className="mt-1 text-sm text-white/50">Access your deal pipeline.</p>

          <form action={action} className="mt-6 space-y-4">
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@investportfolio.ai"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
            />

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
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          Portfolio AI
        </p>
      </div>
    </div>
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
