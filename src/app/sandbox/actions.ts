"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";

export type SandboxResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const TEMPLATE_FOLDERS: Record<string, { name: string; folder_type: string }[]> = {
  "Curative Title": [
    { name: "Title Cure", folder_type: "title_cure" },
    { name: "Documents", folder_type: "documents" },
    { name: "Follow-Up Sequences", folder_type: "follow_up" },
  ],
  "Wholesale Pipeline": [
    { name: "Deals", folder_type: "deals" },
    { name: "Follow-Up Sequences", folder_type: "follow_up" },
    { name: "Documents", folder_type: "documents" },
    { name: "Cold Call Scripts", folder_type: "cold_call" },
  ],
  "Creative Finance": [
    { name: "Deals", folder_type: "deals" },
    { name: "Documents", folder_type: "documents" },
    { name: "Follow-Up Sequences", folder_type: "follow_up" },
  ],
  "Content Strategy": [
    { name: "Content", folder_type: "content" },
    { name: "Documents", folder_type: "documents" },
  ],
  "Multifamily Strategy": [
    { name: "Deals", folder_type: "deals" },
    { name: "Documents", folder_type: "documents" },
    { name: "Follow-Up Sequences", folder_type: "follow_up" },
  ],
  "Business Acquisition": [
    { name: "Deals", folder_type: "deals" },
    { name: "Documents", folder_type: "documents" },
    { name: "Follow-Up Sequences", folder_type: "follow_up" },
  ],
  "Blank": [
    { name: "Documents", folder_type: "documents" },
  ],
};

export async function createSandbox(input: {
  title: string;
  description: string;
  template: string;
}): Promise<SandboxResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  if (!canManage(user.role)) return { ok: false, error: "Not authorized." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required." };

  const template = input.template || "Blank";
  const supabase = await createClient();

  const { data: sandbox, error } = await supabase
    .from("sandboxes")
    .insert({
      user_id: user.id,
      title,
      description: input.description.trim() || null,
      template,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !sandbox) {
    return { ok: false, error: error?.message ?? "Failed to create sandbox." };
  }

  const folders = TEMPLATE_FOLDERS[template] ?? TEMPLATE_FOLDERS["Blank"];
  if (folders.length) {
    await supabase.from("sandbox_folders").insert(
      folders.map((f, i) => ({
        sandbox_id: sandbox.id,
        name: f.name,
        folder_type: f.folder_type,
        position: i,
      })),
    );
  }

  return { ok: true, id: sandbox.id };
}
