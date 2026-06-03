"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined,
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-gold text-lg font-bold text-navy-950">
            P
          </span>
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-wide text-white">
              Portfolio AI
            </div>
            <div className="text-xs text-slate-400">Capital</div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-navy-900 p-6 shadow-2xl">
          <h1 className="text-lg font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-sm text-slate-400">
            Access your deal pipeline.
          </p>

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
              <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-400/20">
                {state.error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-navy-950 transition-colors hover:bg-gold-soft disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Portfolio AI Capital LLC
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
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <input
        {...props}
        required
        className="w-full rounded-md border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
      />
    </label>
  );
}
