import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  SandboxInterior,
  type SandboxFolder,
  type SandboxModule,
} from "./sandbox-interior";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("sandboxes")
    .select("title")
    .eq("id", id)
    .single();
  return { title: `${(data?.title as string | null) ?? "Sandbox"} — Portfolio AI` };
}

export default async function SandboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) notFound();
  if (user.role === "kp" || user.role === "viewer") notFound();

  const supabase = await createClient();

  const { data: sandbox } = await supabase
    .from("sandboxes")
    .select("id, title, template, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!sandbox) notFound();

  const [{ data: folderRows }, { data: moduleRows }] = await Promise.all([
    supabase
      .from("sandbox_folders")
      .select("id, name, folder_type, position")
      .eq("sandbox_id", id)
      .order("position", { ascending: true }),
    supabase
      .from("sandbox_modules")
      .select("id, folder_id, title, description, folder_type, status, created_at")
      .eq("sandbox_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const folders: SandboxFolder[] = (folderRows ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string | null,
    folder_type: f.folder_type as string | null,
    position: f.position as number,
  }));

  const modules: SandboxModule[] = (moduleRows ?? []).map((m) => ({
    id: m.id as string,
    folder_id: m.folder_id as string | null,
    title: m.title as string | null,
    description: m.description as string | null,
    folder_type: m.folder_type as string | null,
    status: (m.status as string) ?? "draft",
    created_at: m.created_at as string,
  }));

  const creatorName =
    (user.full_name as string | null) ??
    (user.email as string | null) ??
    "You";

  return (
    <SandboxInterior
      sandbox={{
        id: sandbox.id as string,
        title: sandbox.title as string | null,
        template: sandbox.template as string | null,
        status: (sandbox.status as string) ?? "active",
      }}
      folders={folders}
      modules={modules}
      creatorName={creatorName}
    />
  );
}
