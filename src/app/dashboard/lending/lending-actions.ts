"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { searchDealThreads, createGmailDraftReply, isGmailConfigured, type GmailThread } from "@/lib/gmail";

export type LendingResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

/** Seed checklist items from the template table for a deal, idempotently. */
export async function seedDealChecklist(dealId: string): Promise<LendingResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();

  // Only seed if no rows exist yet
  const { count } = await supabase
    .from("lending_checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  if ((count ?? 0) > 0) return { ok: true };

  const { data: templates } = await supabase
    .from("lending_checklist_templates")
    .select("stage, position, item_text")
    .order("stage")
    .order("position");

  if (!templates?.length) return { ok: false, error: "No checklist templates found." };

  const { error } = await supabase.from("lending_checklist_items").insert(
    templates.map((t) => ({
      deal_id: dealId,
      stage: t.stage,
      position: t.position,
      item_text: t.item_text,
    })),
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/lending/${dealId}`);
  return { ok: true };
}

/** Seed lender readiness docs for a deal based on its asset class. */
export async function seedDealReadinessDocs(
  dealId: string,
  assetClass: "commercial" | "residential",
): Promise<LendingResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();

  const { count } = await supabase
    .from("lender_readiness_docs")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  if ((count ?? 0) > 0) return { ok: true };

  const { data: templates } = await supabase
    .from("lender_readiness_templates")
    .select("doc_name, position")
    .eq("asset_class", assetClass)
    .order("position");

  if (!templates?.length) return { ok: false, error: "No readiness doc templates found." };

  const { error } = await supabase.from("lender_readiness_docs").insert(
    templates.map((t) => ({
      deal_id: dealId,
      doc_name: t.doc_name,
      asset_class: assetClass,
      position: t.position,
    })),
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/lending/${dealId}`);
  return { ok: true };
}

/** Toggle a checklist item's completion state. */
export async function toggleChecklistItem(
  itemId: string,
  completed: boolean,
  dealId: string,
): Promise<LendingResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lending_checklist_items")
    .update({
      completed,
      completed_by: completed ? user.id : null,
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", itemId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/lending/${dealId}`);
  return { ok: true };
}

/** Set or clear the manual lending stage override on a deal. */
export async function setDealStageOverride(
  dealId: string,
  stage: string | null,
): Promise<LendingResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ stage_override: stage })
    .eq("id", dealId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/lending/${dealId}`);
  revalidatePath("/dashboard/lending");
  return { ok: true };
}

/** Toggle a lender readiness doc received state. */
export async function toggleReadinessDoc(
  docId: string,
  received: boolean,
  dealId: string,
): Promise<LendingResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lender_readiness_docs")
    .update({
      received,
      received_at: received ? new Date().toISOString() : null,
    })
    .eq("id", docId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/lending/${dealId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Addendum drafts
// ---------------------------------------------------------------------------

export interface DraftAddendumInput {
  dealId: string;
  title: string;
  promptText: string;
}

/** Create a new addendum draft via AI (version auto-increments). */
export async function createAddendumDraft(
  input: DraftAddendumInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();

  // Get current max version for this deal
  const { data: existing } = await supabase
    .from("addendum_drafts")
    .select("version")
    .eq("deal_id", input.dealId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;

  // Fetch deal data + reference docs for the AI
  const [{ data: deal }, { data: refDocs }] = await Promise.all([
    supabase
      .from("deals")
      .select("property_address, ai_analysis, purchase_price, lender_name")
      .eq("id", input.dealId)
      .maybeSingle(),
    supabase
      .from("lender_reference_docs")
      .select("doc_name, tags, folder:folder_id(name)")
      .limit(20),
  ]);

  // Build context for the AI
  const dealContext = deal
    ? `Deal: ${deal.property_address}, Purchase Price: ${deal.purchase_price ?? "N/A"}, Lender: ${deal.lender_name ?? "N/A"}`
    : "";

  const refContext = refDocs?.length
    ? `Reference docs available: ${refDocs.map((d) => d.doc_name).join(", ")}`
    : "";

  // Import Anthropic SDK
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let content = "";
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a real estate transaction coordinator drafting a professional addendum for a creative finance deal.

${dealContext}
${refContext}

Lender's specific request:
${input.promptText}

Draft a professional, legally-precise addendum. Use plain English. Be specific about parties, amounts, and timelines where known. Output only the addendum text itself, starting with the title.`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type === "text") content = block.text;
  } catch (e) {
    console.error("AI draft failed:", e);
    content = `[AI drafting failed — manual draft required]\n\nPrompt: ${input.promptText}`;
  }

  const { data: draft, error } = await supabase
    .from("addendum_drafts")
    .insert({
      deal_id: input.dealId,
      title: input.title || `Addendum v${nextVersion}`,
      content,
      prompt_used: input.promptText,
      version: nextVersion,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/lending/${input.dealId}`);
  return { ok: true, id: draft.id };
}

// ---------------------------------------------------------------------------
// Gmail integration
// ---------------------------------------------------------------------------

export { isGmailConfigured };

/** Fetch Gmail threads related to a deal's lender + address. */
export async function getDealGmailThreads(params: {
  lenderName: string | null;
  propertyAddress: string;
}): Promise<{ threads: GmailThread[]; configured: boolean }> {
  const user = await getSessionUser();
  if (!user) return { threads: [], configured: false };

  const configured = isGmailConfigured();
  if (!configured) return { threads: [], configured: false };

  const threads = await searchDealThreads(params);
  return { threads, configured: true };
}

/** Draft an AI reply to a Gmail thread and save it in Gmail drafts. */
export async function draftGmailReply(params: {
  threadId: string;
  to: string;
  subject: string;
  dealId: string;
  context: string;
}): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not authorized." };

  if (!isGmailConfigured()) {
    return { ok: false, error: "Gmail not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN." };
  }

  // Fetch deal context for AI
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("property_address, lender_name, purchase_price, ai_analysis")
    .eq("id", params.dealId)
    .maybeSingle();

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const dealCtx = deal
    ? `Deal: ${(deal as { property_address?: string }).property_address}, Lender: ${(deal as { lender_name?: string | null }).lender_name ?? "N/A"}`
    : "";

  let body = "";
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are drafting a professional email reply on behalf of a creative finance real estate investor.

${dealCtx}

Thread context: ${params.context}

Draft a concise, professional reply. No greeting beyond "Hi [Name]," and close with "Thank you." Output only the email body.`,
        },
      ],
    });
    const block = msg.content[0];
    if (block.type === "text") body = block.text;
  } catch (e) {
    console.error("AI reply draft failed:", e);
    body = `[Auto-draft failed — please write your reply manually]\n\nRe: ${params.subject}`;
  }

  const result = await createGmailDraftReply({
    threadId: params.threadId,
    to: params.to,
    subject: params.subject.startsWith("Re:") ? params.subject : `Re: ${params.subject}`,
    body,
  });

  if (!result) return { ok: false, error: "Gmail draft creation failed." };
  return { ok: true, draftId: result.draftId };
}

/** Update addendum draft content (each edit is a new version). */
export async function updateAddendumDraft(
  draftId: string,
  content: string,
  status?: "draft" | "in_review" | "finalized",
): Promise<LendingResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("addendum_drafts")
    .select("deal_id, version")
    .eq("id", draftId)
    .maybeSingle();

  if (!current) return { ok: false, error: "Draft not found." };

  // Always create a new version — never overwrite
  const { error } = await supabase.from("addendum_drafts").insert({
    deal_id: current.deal_id,
    title: `Addendum v${current.version + 1}`,
    content,
    version: current.version + 1,
    status: status ?? "draft",
    created_by: user.id,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/lending/${current.deal_id}`);
  return { ok: true };
}
