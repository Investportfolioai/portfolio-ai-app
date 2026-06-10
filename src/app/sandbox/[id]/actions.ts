"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { YoutubeTranscript } from "youtube-transcript";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

function getClient(): Anthropic {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").replace(/\s/g, "");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  return new Anthropic({ apiKey });
}

// ---------------------------------------------------------------------------
// YouTube transcript helpers
// ---------------------------------------------------------------------------

const YOUTUBE_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?(?:\S*&)?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;

function extractYouTubeUrls(text: string): string[] {
  const seen = new Set<string>();
  const re = new RegExp(YOUTUBE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    seen.add(match[0]);
  }
  return [...seen];
}

async function fetchTranscripts(urls: string[]): Promise<string> {
  const parts: string[] = [];
  for (const url of urls) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(url);
      const text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
      if (text) parts.push(`[Transcript: ${url}]\n${text}`);
    } catch (err) {
      console.warn("[sandbox] transcript unavailable for", url, (err as Error).message);
    }
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Module schema
// ---------------------------------------------------------------------------

const MODULE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    content: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["checklist", "script", "sequence", "text"],
          },
          value: { type: "string" },
        },
        required: ["type", "value"],
      },
    },
    folder_type: { type: "string" },
    status: { type: "string", enum: ["draft", "live"] },
  },
  required: ["title", "description", "content", "folder_type", "status"],
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentBlock {
  type: "checklist" | "script" | "sequence" | "text";
  value: string;
}

export interface BuiltModule {
  id: string;
  title: string;
  description: string;
  folder_type: string;
  status: string;
  created_at: string;
  folder_id: string | null;
  content: ContentBlock[] | null;
}

export type BuildModuleResult =
  | { ok: true; module: BuiltModule }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Google Sheets / CSV export helper
// ---------------------------------------------------------------------------

const SHEETS_KEYWORDS = /\b(google\s+sheets?|spreadsheets?|csv|export\s+format)\b/i;

function toSheetsBlock(content: ContentBlock[]): ContentBlock | null {
  const rows: string[][] = [];

  for (const block of content) {
    const lines = block.value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (block.type === "checklist" || block.type === "sequence") {
      if (lines.length === 0) continue;
      if (rows.length > 0) rows.push([]);
      rows.push([block.type === "sequence" ? "Step" : "#", "Item"]);
      lines.forEach((item, i) => rows.push([String(i + 1), item]));
    } else {
      // Extract markdown tables or comma-structured lines from text/script blocks
      const tableLike = lines.filter((l) => l.startsWith("|") || l.split(",").length >= 3);
      if (tableLike.length < 2) continue;
      if (rows.length > 0) rows.push([]);
      for (const line of tableLike) {
        if (line.startsWith("|")) {
          const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
          if (cells.every((c) => /^[-:]+$/.test(c))) continue; // skip separator rows
          if (cells.length > 0) rows.push(cells);
        } else {
          rows.push(line.split(",").map((c) => c.trim()));
        }
      }
    }
  }

  if (rows.length === 0) return null;
  const tsv = rows.map((r) => r.join("\t")).join("\n");
  return {
    type: "text",
    value: `[Google Sheets — select cell A1, then paste]\n\n${tsv}`,
  };
}

// ---------------------------------------------------------------------------
// buildModule
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a real estate and business strategy AI. The user may provide YouTube video transcripts and a build request. Use the transcripts as primary source material, supplement with web research when helpful, and generate a module by calling create_module with these fields:
- title (string): concise name, 3-6 words
- description (string): 1-2 sentence summary of what this module does and its value
- content (array of objects with type and value):
  - type "checklist": use for step-by-step action items or due diligence lists
  - type "script": use for call scripts, objection handling, or conversation flows
  - type "sequence": use for follow-up drip sequences or multi-step outreach
  - type "text": use for narrative explanations, strategy notes, or templates
  Generate as many content blocks as needed to be genuinely useful. Each value should be substantial and actionable.
- folder_type (string): the folder type provided
- status: always "draft"

Ground everything in the transcripts if provided. Use web_search to fill gaps or verify current market data.`;

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

  // Fetch any YouTube transcripts embedded in the prompt
  let transcriptText = "";
  let transcriptNote = "";
  try {
    const youtubeUrls = extractYouTubeUrls(prompt);
    if (youtubeUrls.length > 0) {
      transcriptText = await fetchTranscripts(youtubeUrls);
      if (!transcriptText) {
        transcriptNote = "Note: YouTube transcript was unavailable — build from the prompt alone.";
      }
    }
  } catch (err) {
    console.warn("[sandbox] transcript section failed:", (err as Error).message);
    transcriptNote = "Note: YouTube transcript was unavailable — build from the prompt alone.";
  }

  // Build user message content
  const msgParts: string[] = [];
  if (transcriptText) msgParts.push(transcriptText);
  if (transcriptNote) msgParts.push(transcriptNote);
  msgParts.push(`Sandbox: "${sandbox.title as string}"\nFolder type: ${folderType}\nBuild request: ${prompt}`);
  const userContent = msgParts.join("\n\n---\n");

  const client = getClient();

  const tools = [
    { type: "web_search_20250305", name: "web_search" },
    {
      name: "create_module",
      description: "Create a sandbox module with the specified fields.",
      input_schema: MODULE_SCHEMA as unknown as Anthropic.Tool["input_schema"],
    },
  ] as unknown as Anthropic.MessageCreateParams["tools"];

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sandbox] buildModule error:", msg);
    return { ok: false, error: "AI call failed. Try again." };
  }

  console.log("[sandbox] buildModule raw response:", JSON.stringify(response.content, null, 2));

  const block = response.content.find(
    (b) => b.type === "tool_use" && b.name === "create_module",
  );
  if (!block || block.type !== "tool_use") {
    console.error("[sandbox] No create_module call. stop_reason:", response.stop_reason);
    return { ok: false, error: "AI did not return a module." };
  }

  console.log("[sandbox] create_module input:", JSON.stringify(block.input, null, 2));

  const rawInput = block.input as Record<string, unknown>;

  // Handle content in different shapes Claude might return
  let parsedContent: ContentBlock[] = [];
  if (Array.isArray(rawInput.content) && (rawInput.content as unknown[]).length > 0) {
    parsedContent = rawInput.content as ContentBlock[];
  } else if (Array.isArray(rawInput) && (rawInput as unknown[]).length > 0) {
    parsedContent = rawInput as unknown as ContentBlock[];
  }

  if (parsedContent.length === 0) {
    console.warn("[sandbox] create_module returned empty content. raw input:", JSON.stringify(rawInput, null, 2));
  }

  // Append a tab-separated Google Sheets block when the prompt requests it
  if (parsedContent.length > 0 && SHEETS_KEYWORDS.test(prompt)) {
    const sheetsBlock = toSheetsBlock(parsedContent);
    if (sheetsBlock) parsedContent = [...parsedContent, sheetsBlock];
  }

  const ai = {
    title: (rawInput.title as string | undefined) || "Untitled Module",
    description: (rawInput.description as string | undefined) || "",
    content: parsedContent,
    folder_type: (rawInput.folder_type as string | undefined) || folderType,
    status: "draft",
  };

  const { data: mod, error: insertErr } = await supabase
    .from("sandbox_modules")
    .insert({
      sandbox_id: sandboxId,
      folder_id: folderId,
      title: ai.title,
      description: ai.description,
      content: parsedContent.length > 0 ? parsedContent : null,
      folder_type: ai.folder_type,
      status: "draft",
      created_by: user.id,
    })
    .select("id, title, description, folder_type, status, created_at, folder_id, content")
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

// ---------------------------------------------------------------------------
// updateModuleContent — debounced auto-save, no revalidate (client is source of truth)
// ---------------------------------------------------------------------------

export async function updateModuleContent(
  moduleId: string,
  content: ContentBlock[],
  title?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  if (!canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();

  const updates: Record<string, unknown> = { content };
  if (title !== undefined) updates.title = title.trim() || null;

  const { error } = await supabase
    .from("sandbox_modules")
    .update(updates)
    .eq("id", moduleId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// fetchModuleContent — lightweight poll used by module panel when content is empty
// ---------------------------------------------------------------------------

export async function fetchModuleContent(moduleId: string): Promise<ContentBlock[] | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("sandbox_modules")
    .select("content")
    .eq("id", moduleId)
    .single();
  return (data?.content as ContentBlock[] | null) ?? null;
}

// ---------------------------------------------------------------------------
// editModuleWithAI — sends current content + instruction to Claude, saves result
// ---------------------------------------------------------------------------

const EDIT_SCHEMA = {
  type: "object",
  properties: {
    content: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["checklist", "script", "sequence", "text"] },
          value: { type: "string" },
        },
        required: ["type", "value"],
      },
    },
  },
  required: ["content"],
} as const;

export type EditModuleResult =
  | { ok: true; content: ContentBlock[] }
  | { ok: false; error: string };

export async function editModuleWithAI(
  moduleId: string,
  currentContent: ContentBlock[],
  prompt: string,
): Promise<EditModuleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  if (!canManage(user.role)) return { ok: false, error: "Not authorized." };

  try {
    const client = getClient();

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: "You are editing a module. The user will give you the current content array and an instruction. Return ONLY a valid JSON array of content blocks with the same structure: [{type, value}]. No markdown, no explanation, just the array.",
        messages: [
          {
            role: "user",
            content: `Current content: ${JSON.stringify(currentContent)}\n\nInstruction: ${prompt}`,
          },
        ],
      });
    } catch (apiErr) {
      console.error("[sandbox] editModuleWithAI API call failed:", apiErr);
      return { ok: true, content: currentContent };
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.error("[sandbox] editModuleWithAI: no text block in response:", JSON.stringify(response.content));
      return { ok: true, content: currentContent };
    }

    const rawText = textBlock.text.trim();
    console.log("[sandbox] editModuleWithAI raw response:", rawText);

    // Strip markdown code fences if present
    const stripped = rawText
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    let newContent: ContentBlock[];
    try {
      const parsed = JSON.parse(stripped);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.warn("[sandbox] editModuleWithAI: result is not a non-empty array:", stripped);
        return { ok: true, content: currentContent };
      }
      newContent = parsed as ContentBlock[];
    } catch (parseErr) {
      console.error("[sandbox] editModuleWithAI: JSON.parse failed:", parseErr, "\nRaw text:", stripped);
      return { ok: true, content: currentContent };
    }

    const supabase = await createClient();
    const { error: dbErr } = await supabase
      .from("sandbox_modules")
      .update({ content: newContent })
      .eq("id", moduleId);

    if (dbErr) {
      console.error("[sandbox] editModuleWithAI: DB update error:", dbErr.message);
    }

    return { ok: true, content: newContent };
  } catch (err) {
    console.error("[sandbox] editModuleWithAI unexpected error:", err);
    return { ok: true, content: currentContent };
  }
}
