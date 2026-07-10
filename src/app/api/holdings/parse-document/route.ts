import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManagePortfolio } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "documents";
const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are a real estate document parser. Extract the following fields from this document and return ONLY valid JSON with no other text:
{
  balloon_date: 'YYYY-MM-DD or null',
  maturity_date: 'YYYY-MM-DD or null',
  extension_clause: 'description or null',
  monthly_payment: 'number or null',
  seller_carry_payment: 'number or null',
  seller_carry_balance: 'number or null',
  seller_carry_maturity: 'YYYY-MM-DD or null',
  income_rent: 'number or null',
  lease_end_date: 'YYYY-MM-DD or null',
  tenant_name: 'string or null',
  purchase_price: 'number or null',
  important_notes: 'bullet list of material clauses: prepayment penalties, rate adjustments, extension options, key dates, anything a real estate investor must know',
  prepayment_penalty: 'description or null',
  rate_adjustment: 'description or null'
}`;

interface Parsed {
  balloon_date?: string | null;
  maturity_date?: string | null;
  extension_clause?: string | null;
  monthly_payment?: number | null;
  seller_carry_payment?: number | null;
  seller_carry_balance?: number | null;
  seller_carry_maturity?: string | null;
  income_rent?: number | null;
  lease_end_date?: string | null;
  tenant_name?: string | null;
  purchase_price?: number | null;
  important_notes?: string | null;
  prepayment_penalty?: string | null;
  rate_adjustment?: string | null;
}

function mediaType(path: string): string {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/pdf";
}

/** Pull the first JSON object out of the model's text (tolerates stray prose/fences). */
function extractJson(text: string): Parsed | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Parsed;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => {
  if (v == null || v === "" || v === "null") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (v == null || v === "null") return null;
  const s = String(v).trim();
  return s || null;
};
const empty = (v: unknown) => v === null || v === undefined || v === "" || v === 0;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManagePortfolio(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { holding_id?: string; file_url?: string; doc_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { holding_id, file_url } = body;
  if (!holding_id || !file_url) {
    return NextResponse.json({ error: "Missing holding_id or file_url" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1) Download the file from Storage.
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(file_url);
  if (dlErr || !blob) {
    return NextResponse.json({ error: `Download failed: ${dlErr?.message ?? "no file"}` }, { status: 400 });
  }
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const mt = mediaType(file_url);

  // 2) Parse with Claude.
  const apiKey = process.env.ANTHROPIC_API_KEY?.replace(/\s/g, "");
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  const client = new Anthropic({ apiKey });

  const docBlock: Anthropic.ContentBlockParam = mt.startsWith("image/")
    ? { type: "image", source: { type: "base64", media_type: mt as "image/png", data: base64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };

  let parsed: Parsed | null = null;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [
        { role: "user", content: [docBlock, { type: "text", text: "Parse this document. Return only the JSON object." }] },
      ],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    parsed = extractJson(text);
  } catch (e) {
    return NextResponse.json({ error: `Parse failed: ${(e as Error).message}` }, { status: 502 });
  }
  if (!parsed) return NextResponse.json({ error: "Could not extract structured data." }, { status: 502 });

  // 3) Store raw parsed_data on the document row.
  await admin
    .from("holding_documents")
    .update({ parsed_data: parsed })
    .eq("holding_id", holding_id)
    .eq("file_url", file_url);

  // 4) Apply to holdings — only where the current value is empty (never clobber manual entries).
  const { data: holding } = await admin.from("holdings").select("*").eq("id", holding_id).maybeSingle();
  const updated: string[] = [];
  if (holding) {
    const candidates: Record<string, unknown> = {
      balloon_date: str(parsed.balloon_date) ?? str(parsed.maturity_date),
      extension_clause: str(parsed.extension_clause),
      monthly_payment: num(parsed.monthly_payment),
      seller_carry_payment: num(parsed.seller_carry_payment),
      seller_carry_balance: num(parsed.seller_carry_balance),
      seller_carry_maturity: str(parsed.seller_carry_maturity),
      lease_end_date: str(parsed.lease_end_date),
      tenant_name: str(parsed.tenant_name),
      purchase_close_price: num(parsed.purchase_price),
      important_notes: str(parsed.important_notes),
    };
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(candidates)) {
      if (v != null && empty(holding[k])) {
        patch[k] = v;
        updated.push(k);
      }
    }
    if (Object.keys(patch).length) await admin.from("holdings").update(patch).eq("id", holding_id);
  }

  // 5) Apply income/outflow to financials (auto-create row, only fill empties).
  let { data: fin } = await admin.from("holding_financials").select("*").eq("holding_id", holding_id).maybeSingle();
  if (!fin) {
    const ins = await admin.from("holding_financials").insert({ holding_id }).select("*").single();
    fin = ins.data;
  }
  if (fin) {
    const finCandidates: Record<string, number | null> = {
      income_rent: num(parsed.income_rent),
      outflow_mortgage: num(parsed.monthly_payment),
      outflow_seller_carry: num(parsed.seller_carry_payment),
    };
    const finPatch: Record<string, number> = {};
    for (const [k, v] of Object.entries(finCandidates)) {
      if (v != null && empty(fin[k])) {
        finPatch[k] = v;
        updated.push(k);
      }
    }
    if (Object.keys(finPatch).length) {
      await admin.from("holding_financials").update(finPatch).eq("holding_id", holding_id);
    }
  }

  return NextResponse.json({ success: true, parsed, updated });
}
