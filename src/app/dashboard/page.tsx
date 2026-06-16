import Link from "next/link";
import { AchievementBoard, LiveActivity } from "./achievement-board";
import { DashboardIntel } from "./dashboard-intel";
import { DashboardShortcuts } from "./dashboard-shortcuts";
import { PipelineStatus } from "./pipeline-status";

export const metadata = { title: "Dashboard — Portfolio AI" };
export const dynamic = "force-dynamic";

export default function DashboardHome() {
  return (
    <div
      className="fade-up min-h-screen px-4 py-6 sm:px-8 sm:py-8"
      style={{ background: "#0A0B14", position: "relative" }}
    >
      {/* Ambient gold orb */}
      <div style={{
        position: "fixed",
        top: "-200px",
        left: "-200px",
        width: "600px",
        height: "600px",
        background: "radial-gradient(circle, rgba(201,168,76,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <div className="relative mx-auto max-w-7xl space-y-6" style={{ zIndex: 1 }}>
        {/* Historical context */}
        <AchievementBoard />

        {/* Live operational data: KPI row + pipeline panels */}
        <DashboardIntel />

        {/* Pipeline situation at a glance */}
        <PipelineStatus />

        {/* Live Activity */}
        <LiveActivity />

        {/* Keyboard shortcuts — ? button + g→navigation */}
        <DashboardShortcuts />

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
      className="flat-card group block min-w-[150px] px-4 py-3"
      style={{ color: "#fff", textDecoration: "none" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <span className="text-[10px] transition-transform group-hover:translate-x-0.5" style={{ color: "#C9A84C" }}>{icon}</span>
      </div>
      <div className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{desc}</div>
    </Link>
  );
}
