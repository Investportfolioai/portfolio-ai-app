"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLender } from "../people-actions";
import { LENDER_TYPE_LABELS, type LenderType } from "@/lib/types";

export function AddLenderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function num(fd: FormData, k: string): number | null {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? null : Number(v);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await createLender({
        name: String(fd.get("name") ?? ""),
        type: String(fd.get("type") ?? "") as LenderType | "",
        rate: num(fd, "rate"),
        max_ltv: num(fd, "max_ltv"),
        contact_name: String(fd.get("contact_name") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        email: String(fd.get("email") ?? ""),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90"
      >
        + Add Lender
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-primary/40 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg text-primary">Add Lender</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
              <LField label="Name" name="name" required />
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Type</span>
                <select name="type" defaultValue="hard_money" className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent">
                  {(Object.keys(LENDER_TYPE_LABELS) as LenderType[]).map((t) => (
                    <option key={t} value={t}>{LENDER_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <LField label="Rate (%)" name="rate" type="number" />
                <LField label="Max LTV (%)" name="max_ltv" type="number" />
              </div>
              <LField label="Contact Name" name="contact_name" />
              <div className="grid grid-cols-2 gap-3">
                <LField label="Phone" name="phone" type="tel" />
                <LField label="Email" name="email" type="email" />
              </div>
              {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground">Cancel</button>
                <button type="submit" disabled={pending} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60">{pending ? "Adding…" : "Add Lender"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function LField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <input {...props} step={props.type === "number" ? "any" : undefined} className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
    </label>
  );
}
