"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ASSIGNMENT_STATUS_LABELS,
  ROLE_LABELS,
  STRUCTURE_LABELS,
  type AssignmentStatus,
  type KpDeal,
  type KpSreo,
  type UserRole,
} from "@/lib/types";
import { money } from "@/lib/format";
import { logout } from "@/app/login/actions";

type Tab = "deals" | "sreo" | "profile";

interface Profile {
  name: string | null;
  email: string | null;
  role: UserRole | null;
  entity: string | null;
}

const grade = (g: number | null) => (g == null ? "—" : `${g}/100`);

const STATUS_BADGE: Record<AssignmentStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  accepted: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  declined: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
};

export function KpDashboardClient({
  profile,
  deals,
  sreo,
}: {
  profile: Profile;
  deals: KpDeal[];
  sreo: KpSreo[];
}) {
  const [tab, setTab] = useState<Tab>("deals");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Image
            src="/logo-dark.png"
            alt="Portfolio AI"
            width={150}
            height={40}
            className="h-9 w-auto rounded-md"
            priority
          />
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {profile.name ?? profile.email ?? "Key Principal"}
            </span>
            <form action={logout}>
              <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-3xl tracking-tight text-primary">My Dashboard</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          Your deals, your portfolio, your profile.
        </p>

        <nav className="mt-6 flex gap-1 border-b border-border">
          {(
            [
              ["deals", "My Deals"],
              ["sreo", "My SREO"],
              ["profile", "Profile"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-accent text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-6">
          {tab === "deals" && <DealsTab deals={deals} />}
          {tab === "sreo" && <SreoTab sreo={sreo} />}
          {tab === "profile" && <ProfileTab profile={profile} />}
        </div>
      </div>
    </div>
  );
}

function DealsTab({ deals }: { deals: KpDeal[] }) {
  const pending = deals.filter((d) => d.status === "pending");
  const decided = deals.filter((d) => d.status !== "pending");

  if (deals.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
        <p className="text-sm font-medium text-primary">No deals assigned yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          You&apos;ll see deals here when the team invites you onto one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Awaiting your response
          </h2>
          <div className="space-y-3">
            {pending.map((d) => (
              <DealCard key={d.assignment_id} deal={d} actionable />
            ))}
          </div>
        </section>
      )}
      {decided.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            History
          </h2>
          <div className="space-y-3">
            {decided.map((d) => (
              <DealCard key={d.assignment_id} deal={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DealCard({ deal, actionable }: { deal: KpDeal; actionable?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function respond(action: AssignmentStatus) {
    setError("");
    start(async () => {
      const r = await fetch("/api/kp/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deal.assignment_id, action }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not record your response.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-primary">{deal.property_address}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {STRUCTURE_LABELS[deal.structure_type] ?? deal.structure_type}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${STATUS_BADGE[deal.status]}`}
        >
          {ASSIGNMENT_STATUS_LABELS[deal.status]}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Field label="Purchase" value={money(deal.purchase_price)} />
        <Field label="ARV" value={money(deal.arv)} />
        <Field label="ACQ" value={grade(deal.acquisition_grade)} />
        <Field label="STAB" value={grade(deal.stabilization_grade)} />
      </div>

      {actionable && (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={pending}
            onClick={() => respond("accepted")}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            disabled={pending}
            onClick={() => respond("declined")}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            Decline
          </button>
          {error && <span className="text-xs text-rose-400">{error}</span>}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="data-number tabular-nums text-primary">{value}</p>
    </div>
  );
}

const EMPTY_SREO = {
  property_name: "",
  property_type: "",
  address: "",
  value: "",
  mortgage_balance: "",
  monthly_payment: "",
};

function SreoTab({ sreo }: { sreo: KpSreo[] }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_SREO);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    setError("");
    start(async () => {
      const r = await fetch("/api/kp/sreo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not add the property.");
        return;
      }
      setForm(EMPTY_SREO);
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      await fetch(`/api/kp/sreo?id=${id}`, { method: "DELETE" });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Schedule of Real Estate Owned
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          {open ? "Cancel" : "Add Property"}
        </button>
      </div>

      {open && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Property name *" value={form.property_name} onChange={(v) => setForm({ ...form, property_name: v })} />
            <Input label="Type" value={form.property_type} onChange={(v) => setForm({ ...form, property_type: v })} placeholder="SFR, multifamily…" />
            <Input label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} className="sm:col-span-2" />
            <Input label="Value" value={form.value} onChange={(v) => setForm({ ...form, value: v })} type="number" />
            <Input label="Mortgage balance" value={form.mortgage_balance} onChange={(v) => setForm({ ...form, mortgage_balance: v })} type="number" />
            <Input label="Monthly payment" value={form.monthly_payment} onChange={(v) => setForm({ ...form, monthly_payment: v })} type="number" />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              disabled={pending}
              onClick={submit}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              Save Property
            </button>
            {error && <span className="text-xs text-rose-400">{error}</span>}
          </div>
        </div>
      )}

      {sreo.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-primary">No properties yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add the real estate you own to build your SREO.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 text-right font-medium">Mortgage</th>
                <th className="px-4 py-3 text-right font-medium">Monthly</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sreo.map((p) => (
                <tr key={p.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium text-primary">{p.property_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.property_type ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.address ?? "—"}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{money(p.value)}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{money(p.mortgage_balance)}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{money(p.monthly_payment)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(p.id)}
                      disabled={pending}
                      className="text-xs text-muted-foreground hover:text-rose-400 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProfileTab({ profile }: { profile: Profile }) {
  return (
    <div className="max-w-md rounded-2xl border border-border bg-card p-6">
      <dl className="space-y-4 text-sm">
        <Row label="Name" value={profile.name ?? "—"} />
        <Row label="Email" value={profile.email ?? "—"} />
        <Row label="Role" value={profile.role ? ROLE_LABELS[profile.role] : "—"} />
        <Row label="Entity" value={profile.entity ?? "—"} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-primary">{value}</dd>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-primary outline-none focus:border-accent"
      />
    </label>
  );
}
