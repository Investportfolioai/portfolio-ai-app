import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SandboxBoard, type SandboxRow } from "./sandbox-board";

export const metadata = { title: "Sandbox — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function SandboxPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "kp" || user.role === "viewer") redirect("/kp/dashboard");

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

  const stats = {
    total: rows.length,
    active: rows.filter((s) => s.status === "active").length,
    modules: totalModules,
  };

  return <SandboxBoard sandboxes={rows} stats={stats} />;
}
