import Link from "next/link";
import { getDeals, getRecentActivity } from "@/lib/deals";
import { equitySpread, type Deal } from "@/lib/types";
import { money } from "@/lib/format";

export const metadata = { title: "Dashboard — Portfolio AI" };
export const dynamic = "force-dynamic";

function cashInvested(d: Deal): number {
  const ed = d.ai_analysis?.extracted_deal_data;
  const uw = d.ai_analysis?.underwriting;
  return ed?.total_cash_invested ?? uw?.total_cash_invested ?? 0;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function DashboardHome() {
  const [deals, activity] = await Promise.all([getDeals(), getRecentActivity(10)]);
  const active = deals.filter((d) => d.status === "active");
  const capitalDeployed = active.reduce((s, d) => s + cashInvested(d), 0);
  const equityPosition = active.reduce((s, d) => s + (equitySpread(d) ?? 0), 0);
  const acqGrades = deals.map((d) => d.acquisition_grade).filter((g): g is number => g != null);
  const stabGrades = deals.map((d) => d.stabilization_grade).filter((g): g is number => g != null);
  const avgAcq = avg(acqGrades);
  const avgStab = avg(stabGrades);

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Dashboard</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          The person who controls the structure controls the money, the equity,
          and the outcome.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Metric label="Total Deals" value={String(deals.length)} />
        <Metric label="Active Deals" value={String(active.length)} />
        <Metric label="Capital Deployed" value={money(capitalDeployed)} accent />
        <Metric label="Equity Position" value={money(equityPosition)} accent />
        <Metric label="Avg ACQ Grade" value={avgAcq == null ? "—" : `${avgAcq}`} />
        <Metric label="Avg STAB Grade" value={avgStab == null ? "—" : `${avgStab}`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
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

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "data-number mt-2 text-2xl font-medium tabular-nums " +
          (accent ? "text-accent" : "text-primary")
        }
      >
        {value}
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
