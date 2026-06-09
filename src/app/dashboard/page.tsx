import Link from "next/link";
import { getRecentActivity } from "@/lib/deals";
import { DashboardIntel } from "./dashboard-intel";

export const metadata = { title: "Dashboard — Portfolio AI" };
export const dynamic = "force-dynamic";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function DashboardHome() {
  const activity = await getRecentActivity(10);

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Dashboard</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          The person who controls the structure controls the money, the equity,
          and the outcome.
        </p>
      </header>

      {/* Sections 1–3: KPI row, pipeline panels, performance stats */}
      <DashboardIntel />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Section 4 — Recent Activity */}
        <section className="lg:col-span-2">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Recent Activity
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {activity.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No activity yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-primary">
                        {a.action.replace(/_/g, " ")}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {a.deal_address}
                        </span>
                      </div>
                      {a.note && (
                        <div className="truncate text-xs text-muted-foreground">{a.note}</div>
                      )}
                    </div>
                    <span className="data-number shrink-0 text-[11px] text-muted-foreground">
                      {fmtDateTime(a.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Section 5 — Quick Links */}
        <section>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Quick Links
          </div>
          <div className="flex flex-col gap-3">
            <QuickLink href="/dashboard/pipeline" title="Pipeline" desc="Work the deal board" />
            <QuickLink href="/dashboard/pipeline" title="Add Deal" desc="Enter a deal manually" accent />
            <QuickLink href="/dashboard/underwriting" title="Underwriting" desc="AI grades & queue" />
          </div>
        </section>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  title,
  desc,
  accent,
}: {
  href: string;
  title: string;
  desc: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-2xl border p-4 transition-colors " +
        (accent
          ? "border-accent/40 bg-accent/10 hover:bg-accent/20"
          : "border-border bg-card hover:border-accent/40")
      }
    >
      <div className="text-sm font-medium text-primary">{title}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </Link>
  );
}
