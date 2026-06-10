"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";

function getClient(): Anthropic {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").replace(/\s/g, "");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  return new Anthropic({ apiKey });
}

const MODULE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    folder_type: { type: "string" },
    status: { type: "string", enum: ["draft", "live"] },
  },
  required: ["title", "description", "folder_type", "status"],
} as const;

export interface BuiltModule {
  id: string;
  title: string;
  description: string;
  folder_type: string;
  status: string;
  created_at: string;
  folder_id: string | null;
}

export type BuildModuleResult =
  | { ok: true; module: BuiltModule }
  | { ok: false; error: string };

export async function buildModule(
  sandboxId: string,
  folderId: string | null,
  folderType: string,
  prompt: string,
): Promise<BuildModuleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  if (!canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();

  const { data: sandbox } = await supabase
    .from("sandboxes")
    .select("id, title")
    .eq("id", sandboxId)
    .eq("user_id", user.id)
    .single();
  if (!sandbox) return { ok: false, error: "Sandbox not found." };

  const client = getClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system: [
        {
          type: "text",
          text: `You are an AI builder inside Portfolio AI's Sandbox workspace. Generate workspace modules — structured tools, templates, trackers, scripts, and workflows — for real estate investors and operators.

Return a module with:
- title: concise name (3-6 words)
- description: 1-2 sentence explanation of what this module does and its value
- folder_type: the folder type provided in the prompt
- status: always "draft"

Be specific and actionable. Context: real estate investment, creative finance, seller outreach, key principals, lenders, title resolution, content marketing.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: "create_module",
          description: "Create a sandbox module.",
          input_schema: MODULE_SCHEMA as unknown as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: "create_module" },
      messages: [
        {
          role: "user",
          content: `Sandbox: "${sandbox.title as string}"\nFolder type: ${folderType}\nPrompt: ${prompt}\n\nBuild this module.`,
        },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sandbox] buildModule error:", msg);
    return { ok: false, error: "AI call failed. Try again." };
  }

  const block = response.content.find(
    (b) => b.type === "tool_use" && b.name === "create_module",
  );
  if (!block || block.type !== "tool_use") {
    return { ok: false, error: "AI did not return a module." };
  }

  const ai = block.input as {
    title: string;
    description: string;
    folder_type: string;
    status: string;
  };

  const { data: mod, error: insertErr } = await supabase
    .from("sandbox_modules")
    .insert({
      sandbox_id: sandboxId,
      folder_id: folderId,
      title: ai.title,
      description: ai.description,
      folder_type: ai.folder_type || folderType,
      status: "draft",
      created_by: user.id,
    })
    .select("id, title, description, folder_type, status, created_at, folder_id")
    .single();

  if (insertErr || !mod) {
    return { ok: false, error: insertErr?.message ?? "Failed to save module." };
  }

  revalidatePath(`/sandbox/${sandboxId}`);
  return { ok: true, module: mod as BuiltModule };
}

// ---------------------------------------------------------------------------
// addFolder
// ---------------------------------------------------------------------------

export interface AddedFolder {
  id: string;
  name: string;
  folder_type: string;
  position: number;
}

export type AddFolderResult =
  | { ok: true; folder: AddedFolder }
  | { ok: false; error: string };

export async function addFolder(
  sandboxId: string,
  name: string,
  folderType: string,
): Promise<AddFolderResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  if (!canManage(user.role)) return { ok: false, error: "Not authorized." };

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "Folder name is required." };

  const supabase = await createClient();

  const { data: sandbox } = await supabase
    .from("sandboxes")
    .select("id")
    .eq("id", sandboxId)
    .eq("user_id", user.id)
    .single();
  if (!sandbox) return { ok: false, error: "Sandbox not found." };

  const { count } = await supabase
    .from("sandbox_folders")
    .select("id", { count: "exact", head: true })
    .eq("sandbox_id", sandboxId);

  const { data: folder, error } = await supabase
    .from("sandbox_folders")
    .insert({
      sandbox_id: sandboxId,
      name: trimmedName,
      folder_type: folderType,
      position: count ?? 0,
    })
    .select("id, name, folder_type, position")
    .single();

  if (error || !folder) {
    return { ok: false, error: error?.message ?? "Failed to create folder." };
  }

  revalidatePath(`/sandbox/${sandboxId}`);
  return { ok: true, folder: folder as AddedFolder };
}
