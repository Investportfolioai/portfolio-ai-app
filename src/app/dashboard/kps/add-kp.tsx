"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createKp, resendKpInvite, createTc, resendTcInvite } from "../people-actions";
import type { UserRole } from "@/lib/types";

export function AddKpButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    setError(null);
    start(async () => {
      const res = await createKp({
        name: String(fd.get("name") ?? ""),
        email,
        phone: String(fd.get("phone") ?? ""),
        role: String(fd.get("role") ?? "kp") as UserRole,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      setInvited(email);
    });
  }

  function close() {
    setOpen(false);
    setError(null);
    setInvited(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90"
      >
        + Add KP
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-primary/40 backdrop-blur-[1px]" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg text-primary">Add Key Principal</h2>
              <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>

            {invited ? (
              <div className="px-6 py-8 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <p className="text-sm font-medium text-primary">Invite sent</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  An account setup link was emailed to <span className="text-primary">{invited}</span>.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 rounded-full bg-secondary px-5 py-2 text-sm font-medium text-secondary-foreground"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
                <PField label="Name" name="name" required />
                <PField label="Email *" name="email" type="email" required />
                <PField label="Phone" name="phone" type="tel" />
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Role</span>
                  <select name="role" defaultValue="kp" className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent">
                    <option value="kp">KP</option>
                    <option value="partner">Partner</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground">Cancel</button>
                  <button type="submit" disabled={pending} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60">{pending ? "Sending invite…" : "Add & invite"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function InviteKpButton({ kpId }: { kpId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [, start] = useTransition();

  function send() {
    setState("sending");
    start(async () => {
      const res = await resendKpInvite(kpId);
      setState(res.ok ? "sent" : "error");
    });
  }

  if (state === "sent") {
    return <span className="text-xs text-emerald-400">Sent</span>;
  }
  if (state === "error") {
    return <span className="text-xs text-rose-400">Failed</span>;
  }

  return (
    <button
      onClick={send}
      disabled={state === "sending"}
      className="text-xs text-muted-foreground hover:text-primary disabled:opacity-50"
    >
      {state === "sending" ? "Sending…" : "Resend invite"}
    </button>
  );
}

function PField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <input {...props} className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
    </label>
  );
}

// ---------------------------------------------------------------------------
// TC invite components
// ---------------------------------------------------------------------------

export interface DealOption { id: string; property_address: string }

export function AddTcButton({ deals }: { deals: DealOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [selectedTabs, setSelectedTabs] = useState<("lending" | "documents")[]>(["lending"]);
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);

  function toggleTab(tab: "lending" | "documents") {
    setSelectedTabs((prev) =>
      prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab],
    );
  }

  function toggleDeal(id: string) {
    setSelectedDeals((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    setError(null);
    start(async () => {
      const res = await createTc({
        name: String(fd.get("name") ?? ""),
        email,
        phone: String(fd.get("phone") ?? ""),
        tabs: selectedTabs,
        dealIds: selectedDeals,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      setInvited(email);
    });
  }

  function close() {
    setOpen(false);
    setError(null);
    setInvited(null);
    setSelectedTabs(["lending"]);
    setSelectedDeals([]);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-border bg-secondary px-4 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
      >
        + Invite TC
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
          <div className="absolute inset-0 bg-primary/40 backdrop-blur-[1px]" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg text-primary">Invite Transaction Coordinator</h2>
              <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>

            {invited ? (
              <div className="px-6 py-8 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <p className="text-sm font-medium text-primary">Invite sent</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  A setup link was emailed to <span className="text-primary">{invited}</span>.
                </p>
                <button type="button" onClick={close} className="mt-5 rounded-full bg-secondary px-5 py-2 text-sm font-medium text-secondary-foreground">Done</button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
                <PField label="Name" name="name" required />
                <PField label="Email *" name="email" type="email" required />
                <PField label="Phone" name="phone" type="tel" />

                {/* Tab grants */}
                <div>
                  <span className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Tab Access</span>
                  <div className="flex gap-2">
                    {(["lending", "documents"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => toggleTab(tab)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          selectedTabs.includes(tab)
                            ? "bg-accent text-accent-foreground"
                            : "border border-border bg-secondary text-muted-foreground"
                        }`}
                      >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Deal grants */}
                {deals.length > 0 && (
                  <div>
                    <span className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      Deals ({selectedDeals.length} selected)
                    </span>
                    <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-secondary">
                      {deals.map((d) => (
                        <label key={d.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-secondary/80">
                          <input
                            type="checkbox"
                            checked={selectedDeals.includes(d.id)}
                            onChange={() => toggleDeal(d.id)}
                            className="accent-[#C9A84C]"
                          />
                          <span className="text-xs text-foreground">{d.property_address}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground">Cancel</button>
                  <button type="submit" disabled={pending} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60">
                    {pending ? "Sending invite…" : "Invite TC"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function ResendTcInviteButton({ tcId }: { tcId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [, start] = useTransition();

  function send() {
    setState("sending");
    start(async () => {
      const res = await resendTcInvite(tcId);
      setState(res.ok ? "sent" : "error");
    });
  }

  if (state === "sent") return <span className="text-xs text-emerald-400">Sent</span>;
  if (state === "error") return <span className="text-xs text-rose-400">Failed</span>;

  return (
    <button
      onClick={send}
      disabled={state === "sending"}
      className="text-xs text-muted-foreground hover:text-primary disabled:opacity-50"
    >
      {state === "sending" ? "Sending…" : "Resend invite"}
    </button>
  );
}
