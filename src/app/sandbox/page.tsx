import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SandboxBoard, type SandboxRow } from "./sandbox-board";

export const metadata = { title: "Sandboxes — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function SandboxPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "kp" || user.role === "viewer") redirect("/kp/dashboard");

  return (
    <Suspense fallback={<SandboxSkeleton />}>
      <SandboxContent />
    </Suspense>
  );
}

async function SandboxContent() {
  const supabase = await createClient();

  const { data: sandboxes } = await supabase
    .from("sandboxes")
    .select("id, title, description, template, status, created_at, updated_at")
    .order("updated_at", { ascending: false });

  const ids = (sandboxes ?? []).map((s) => s.id as string);
  const modulesByBox: Record<string, number> = {};

  if (ids.length) {
    const { data: mods } = await supabase
      .from("sandbox_modules")
      .select("sandbox_id")
      .in("sandbox_id", ids);
    for (const m of mods ?? []) {
      const sid = m.sandbox_id as string;
      modulesByBox[sid] = (modulesByBox[sid] ?? 0) + 1;
    }
  }

  const rows: SandboxRow[] = (sandboxes ?? []).map((s) => ({
    id: s.id as string,
    title: s.title as string | null,
    description: s.description as string | null,
    template: s.template as string | null,
    status: (s.status as string) ?? "active",
    created_at: s.created_at as string,
    updated_at: s.updated_at as string,
    module_count: modulesByBox[s.id as string] ?? 0,
  }));

  const totalModules = Object.values(modulesByBox).reduce((a, b) => a + b, 0);

  return (
    <SandboxBoard
      sandboxes={rows}
      stats={{
        total: rows.length,
        active: rows.filter((s) => s.status === "active").length,
        members: 2,
        modules: totalModules,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeleton — shown via Suspense while SandboxContent resolves
// ---------------------------------------------------------------------------

function SkCard() {
  return (
    <div className="animate-pulse rounded-2xl p-5" style={{ background: "#1a1d27" }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="h-5 w-28 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
        <div className="h-5 w-14 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
      </div>
      <div className="mb-1.5 h-5 w-3/4 rounded" style={{ background: "rgba(255,255,255,0.05)" }} />
      <div className="mb-1 h-4 w-full rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
      <div className="mb-5 h-4 w-2/3 rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
      <div
        className="flex items-center justify-between pt-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="h-4 w-12 rounded" style={{ background: "rgba(255,255,255,0.05)" }} />
        <div className="h-4 w-20 rounded" style={{ background: "rgba(255,255,255,0.05)" }} />
      </div>
    </div>
  );
}

function SandboxSkeleton() {
  return (
    <div style={{ background: "#0A0B14", minHeight: "100vh", padding: "32px" }}>
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="mb-2 h-8 w-44 animate-pulse rounded-lg" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="h-4 w-56 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
          </div>
          <div className="h-10 w-36 animate-pulse rounded-lg" style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
        {/* Search */}
        <div className="mb-6 h-11 w-full animate-pulse rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }} />
        {/* Metric strip */}
        <div
          className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4"
          style={{ background: "#111219", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "16px", padding: "20px 24px" }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="mb-2 h-3 w-20 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.05)" }} />
              <div className="h-7 w-12 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.05)" }} />
            </div>
          ))}
        </div>
        {/* Section label */}
        <div className="mb-4 h-3 w-24 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
        {/* Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => <SkCard key={i} />)}
        </div>
      </div>
    </div>
  );
}
