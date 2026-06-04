"use client";

import { useState } from "react";
import { motion } from "motion/react";

export default function SubmitPage() {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      // The underwriting result is intentionally NOT shown to the wholesaler —
      // grades/recommendation/summary live in the internal pipeline only.
      setStatus("done");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8fa] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.png" alt="Portfolio AI" className="max-h-10 max-w-full" />
        </div>

        {status === "done" ? (
          <Confirmation />
        ) : (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h1 className="text-2xl text-primary">Submit a Deal</h1>
            <p className="mt-1 text-sm italic font-light text-muted-foreground">
              Upload your LOI and deck — our engine reads them and underwrites
              the deal automatically.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <Field label="Your Name" name="name" type="text" required />
              <Field label="Email" name="email" type="email" required />
              <Field label="Phone" name="phone" type="tel" required />
              <FileField
                label="Letter of Intent (PDF)"
                name="loi"
                required
                hint="Required"
              />
              <FileField
                label="Deal Deck (PDF)"
                name="deck"
                hint="Optional"
              />

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">
                  {error}
                </p>
              )}

              <motion.button
                type="submit"
                disabled={status === "submitting"}
                whileHover={{ scale: status === "submitting" ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
              >
                {status === "submitting" ? "Underwriting…" : "Submit Deal"}
              </motion.button>
              {status === "submitting" && (
                <p className="text-center text-xs text-muted-foreground">
                  Reading your documents — this can take up to a minute.
                </p>
              )}
            </form>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Portfolio AI
        </p>
      </div>
    </div>
  );
}

function Confirmation() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm"
    >
      <h1 className="text-2xl text-primary">Deal received</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Thank you — our team will be in touch. No further action is needed.
      </p>
    </motion.div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

function FileField({
  label,
  name,
  required,
  hint,
}: {
  label: string;
  name: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
        {hint && <span className="text-accent">{hint}</span>}
      </span>
      <input
        type="file"
        name={name}
        accept="application/pdf"
        required={required}
        className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}
