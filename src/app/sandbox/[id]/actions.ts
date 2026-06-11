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

const SYSTEM_PROMPT = `You are a real estate and business strategy AI. You must respond with ONLY a raw JSON object. No markdown. No explanation. No backticks. Start your response with { and end with }. The JSON must have these exact fields: title (string), description (string), content (array of objects where each object has type (string) and value (string)), folder_type (string), status (string set to draft).

Content block types for the content array: "checklist" for action items/due diligence lists, "script" for call scripts/objection handling, "sequence" for follow-up drip steps, "text" for strategy notes/templates. Generate as many blocks as needed to be genuinely useful. Each value must be substantial and actionable. For checklist and sequence types, separate individual items with newlines within the value string.`;

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

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sandbox] buildModule API error:", msg);
    return { ok: false, error: "AI call failed. Try again." };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error("[sandbox] buildModule: no text block. stop_reason:", response.stop_reason, JSON.stringify(response.content));
    return { ok: false, error: "AI did not return a module." };
  }

  const fullText = textBlock.text;
  console.log("[sandbox] buildModule raw response:", fullText);

  // Extract the JSON object — find first { and last } to strip any surrounding text
  const start = fullText.indexOf("{");
  const end = fullText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    console.error("[sandbox] buildModule: no JSON object found in response:", fullText);
    return { ok: false, error: "AI did not return a module." };
  }
  const jsonStr = fullText.slice(start, end + 1);

  let rawInput: Record<string, unknown>;
  try {
    rawInput = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch (parseErr) {
    console.error("[sandbox] buildModule JSON.parse failed:", parseErr, "\nExtracted:", jsonStr);
    return { ok: false, error: "AI returned an invalid response." };
  }

  let parsedContent: ContentBlock[] = [];
  if (Array.isArray(rawInput.content)) {
    parsedContent = rawInput.content as ContentBlock[];
  }

  if (parsedContent.length === 0) {
    console.warn("[sandbox] buildModule: empty content. rawInput:", JSON.stringify(rawInput));
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

// Escapes literal control characters inside JSON string values so JSON.parse
// doesn't choke on tabs/newlines from Claude's Google Sheets output.
function sanitizeJsonChars(raw: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') { out += ch; inStr = !inStr; continue; }
    if (inStr) {
      if (ch === "\t") { out += "\\t"; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
    }
    out += ch;
  }
  return out;
}

export async function editModuleWithAI(
  moduleId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentContent: any,
  prompt: string,
) {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: "Not authenticated" };

    const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").replace(/\s/g, "");
    if (!apiKey) return { ok: false, error: "No API key" };

    const contentStr = currentContent && Array.isArray(currentContent) && currentContent.length > 0
      ? JSON.stringify(currentContent)
      : "(empty)";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: "You are editing a module. Return ONLY a valid JSON array. No markdown. No explanation. No backticks. Just a raw JSON array like [{\"type\":\"text\",\"value\":\"content here\"}]. The array must contain objects with type and value fields. When the user asks for a Google Sheets calculator, format the output as tab-separated rows where column B contains actual Excel/Sheets formulas starting with = that reference other cells. For example: row 17 should have =B15*B16 in column B, not the word Auto-calculated. Every numeric calculation must be a real formula.",
        messages: [{
          role: "user",
          content: `Current content: ${contentStr}\n\nInstruction: ${prompt}`,
        }],
      }),
    });

    const data = await res.json();
    console.log("[sandbox] editModuleWithAI raw response:", JSON.stringify(data));

    if (!res.ok) return { ok: false, error: (data.error as { message?: string } | undefined)?.message ?? "API error" };

    const text: string = data?.content?.[0]?.text ?? "";
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");

    let newContent: ContentBlock[];
    if (start !== -1 && end !== -1) {
      const sanitized = sanitizeJsonChars(text.slice(start, end + 1));
      try {
        newContent = JSON.parse(sanitized) as ContentBlock[];
      } catch (parseErr) {
        console.warn("[sandbox] editModuleWithAI JSON.parse failed, using fallback block:", parseErr);
        newContent = [{ type: "text", value: text.trim() }];
      }
    } else {
      // No array brackets at all — save whatever Claude returned as plain text
      newContent = [{ type: "text", value: text.trim() }];
    }

    const supabase = await createClient();
    const { error: dbError } = await supabase
      .from("sandbox_modules")
      .update({ content: newContent, updated_at: new Date().toISOString() })
      .eq("id", moduleId);

    if (dbError) {
      console.error("[sandbox] DB update error:", dbError);
      return { ok: false, error: dbError.message };
    }

    return { ok: true, content: newContent };
  } catch (err) {
    console.error("[sandbox] editModuleWithAI crashed:", err);
    return { ok: false, error: String(err) };
  }
}
