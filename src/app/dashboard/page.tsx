import Link from "next/link";
import { AchievementBoard, LiveActivity } from "./achievement-board";
import { DashboardIntel } from "./dashboard-intel";

export const metadata = { title: "Dashboard — Portfolio AI" };
export const dynamic = "force-dynamic";

export default function DashboardHome() {
  return (
    <div
      className="min-h-screen px-4 py-6 sm:px-8 sm:py-8"
      style={{ background: "#0A0B14" }}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Sections 1–4: Achievement Board (time-toggled, recharts, leaderboard, activity) */}
        <AchievementBoard />

        {/* Section 3: KPI strip + Pipeline panels */}
        <DashboardIntel />

        {/* Section 4: Live Activity */}
        <LiveActivity />

        {/* Quick Links */}
        <section>
          <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-white/25">
            Quick Links
          </div>
          <div className="flex flex-wrap gap-3">
            <QuickLink href="/dashboard/pipeline" title="Pipeline" desc="Work the deal board" icon="→" />
            <QuickLink href="/dashboard/portfolio" title="Portfolio" desc="Holdings & documents" icon="→" />
            <QuickLink href="/dashboard/underwriting" title="Underwriting" desc="AI grades & queue" icon="→" />
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
  icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl px-4 py-3 transition-all min-w-[150px] hover:border-[rgba(201,168,76,0.3)]"
      style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.07)", color: "#fff" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <span className="text-[10px] transition-transform group-hover:translate-x-0.5" style={{ color: "#C9A84C" }}>{icon}</span>
      </div>
      <div className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{desc}</div>
    </Link>
  );
}
