import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { UnderwritingOutput, UnderwritingAnalysis, Recommendation } from "@/lib/types";

export type {
  ExtractedDealData,
  UnderwritingAnalysis,
  UnderwritingOutput,
  Recommendation,
} from "@/lib/types";

/**
 * AI underwriting engine. Claude (opus-4-8) reads the deal — either as base64
 * PDF documents (LOI/deck from /submit) or as structured data (manual deals /
 * seeded deals with no PDFs) — extracts the fields, and underwrites it.
 * Structured output is forced via a single tool call (forced tool_choice and
 * extended thinking are mutually exclusive, so reasoning lives in the schema).
 */

const MODEL = "claude-sonnet-4-6";

export interface PdfInput {
  base64: string;
}

const SYSTEM_PROMPT = `You are an expert real estate underwriter specializing in Morby Method creative finance deals. Your job is to score every deal on two dimensions: ACQ (acquisition) and STAB (stabilization).

DEAL STRUCTURE CONTEXT:
- Primary strategy: Morby Method — institutional first lien at 75% LTV + seller carry second
- Standard first lien assumption: 75% of purchase price, 8% interest, 30-year amortization
- Monthly payment formula: P * (r*(1+r)^360) / ((1+r)^360 - 1) where r = 0.08/12
- Seller carry: the gap between purchase price and first lien. Assume 3% IO if terms not stated.
- Deferred seller carry = $0/month obligations from carry note

ACQ SCORE (0-100) — measures cashback at close and acquisition structure:

Step 1: Calculate first_lien = purchase_price * 0.75
Step 2: Calculate first_lien_payment using 8% 30yr amortization
Step 3: seller_carry = purchase_price - first_lien
Step 4: cashback = (first_lien_proceeds + seller_carry) - purchase_price - closing_costs
  Note: if deal states explicit cashback or net_to_buyer, use that number directly
Step 5: cashback_pct = cashback / purchase_price * 100

ACQ scoring:
- cashback_pct >= 20%: score 90-100 (A)
- cashback_pct 15-19.9%: score 80-89 (B+)
- cashback_pct 10-14.9%: score 70-79 (B)
- cashback_pct 5-9.9%: score 50-69 (C)
- cashback_pct 1-4.9%: score 30-49 (D)
- cashback_pct <= 0%: score 0-29 (F) — deal killer

ACQ adjustments:
- ARV > purchase_price * 1.20: +5
- ARV < purchase_price * 1.05: -10
- Seller carrying > 30% of purchase price: +3
- No ARV provided: -5

STAB SCORE (0-100) — measures rent coverage of total monthly obligations:

Step 1: total_obligations = first_lien_payment + seller_carry_payment + taxes + insurance + hoa
  If seller carry is deferred: seller_carry_payment = 0
Step 2: Use web_search to find current long-term rental comps for the subject property address
Step 3: current_coverage = current_rent / total_obligations * 100
Step 4: projected_coverage = projected_rent / total_obligations * 100

STAB scoring (use current_coverage as base):
- coverage >= 100%: score 85-100 (A) — fully covered
- coverage 90-99%: score 75-84 (B)
- coverage 70-89%: score 60-74 (C)
- coverage 40-69%: score 35-59 (D)
- coverage < 40%: score 0-34 (F)

STAB adjustments:
- Seller carry fully deferred ($0/mo): +15
- Projected coverage >= 130%: +8 (strong value-add upside)
- No rent data available after search: flag 'Rent comp needed', score 50

DEAL TIER (assign one):
- Elite — Paid to Buy: cashback_pct >= 20% AND current_coverage >= 150%
- Buybox — Deferred Carry: cashback_pct >= 10% AND seller_carry_payment = 0
- Buybox — Standard Morby: cashback_pct >= 15%
- Value Add — Strong Upside: cashback_pct >= 10% AND projected_coverage >= 130% AND current_coverage < 100%
- Solid Deal: cashback_pct >= 10% AND current_coverage >= 70%
- Watch: cashback_pct 5-10% OR coverage 50-70%
- Pass: cashback_pct < 5% OR current_coverage < 40%

REQUIRED OUTPUT FORMAT — respond with the submit_underwriting tool call containing:
- acquisition_grade: letter A/B/C/D/F
- stabilization_grade: letter A/B/C/D/F
- acquisition_score: number 0-100
- stabilization_score: number 0-100
- deal_tier: one of the tier labels above
- cashback_amount: dollar amount
- cashback_pct: percentage
- first_lien_amount: calculated
- first_lien_payment: monthly
- seller_carry_amount: calculated
- seller_carry_payment: monthly (0 if deferred)
- total_obligations: monthly
- current_rent: from document or web search
- projected_rent: from document or web search
- current_coverage_pct: percentage
- projected_coverage_pct: percentage
- rent_source: 'document' or 'web_search' or 'estimated'
- ai_summary: 3-4 sentence plain English verdict structured as:
  '[Deal Tier]. Cashback at close: $X (X%). First lien $X/mo + seller carry $X/mo = $X total obligations. Current rent covers X% of obligations[, projected rent covers X% stabilized]. [One sentence on what makes this deal work or what needs to happen for it to work.]'
- important_flags: array of strings — any material items: extension clauses, deferred interest, value-add assumptions, rent comp confidence level, opportunity zone, etc.`;

const num = { type: ["number", "null"] };
const str = { type: ["string", "null"] };

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    extracted_deal_data: {
      type: "object",
      properties: {
        property_address: str,
        city: str,
        state: str,
        property_type: str,
        structure_type: {
          type: ["string", "null"],
          enum: ["morby", "ab_bc", "assignment", "creative", "nnn", "seller_finance", null],
        },
        purchase_price: num,
        arv: num,
        loan_amount: num,
        initial_advance: num,
        holdback: num,
        interest_rate: num,
        ltv: num,
        seller_note_amount: num,
        seller_note_rate: num,
        balloon_term_months: num,
        assignment_fee: num,
        origination_fee: num,
        total_cash_invested: num,
        net_monthly_cashflow: num,
        exit_strategy: {
          type: ["string", "null"],
          enum: ["sell", "refi", "hold", "assignment", null],
        },
        lender_name: str,
        quote_number: str,
      },
      required: ["property_address", "structure_type", "purchase_price", "arv"],
    },
    underwriting: {
      type: "object",
      properties: {
        acquisition_grade: { type: "string", enum: ["A", "B", "C", "D", "F"] },
        stabilization_grade: { type: "string", enum: ["A", "B", "C", "D", "F"] },
        acquisition_score: { type: "integer" },
        stabilization_score: { type: "integer" },
        deal_tier: { type: "string" },
        cashback_amount: num,
        cashback_pct: num,
        first_lien_amount: num,
        first_lien_payment: num,
        seller_carry_amount: num,
        seller_carry_payment: num,
        total_obligations: num,
        current_rent: num,
        projected_rent: num,
        current_coverage_pct: num,
        projected_coverage_pct: num,
        rent_source: str,
        ai_summary: { type: "string" },
        important_flags: { type: "array", items: { type: "string" } },
      },
      required: [
        "acquisition_grade",
        "stabilization_grade",
        "acquisition_score",
        "stabilization_score",
        "deal_tier",
        "ai_summary",
        "important_flags",
      ],
    },
  },
  required: ["extracted_deal_data", "underwriting"],
} as const;

/**
 * Build the Anthropic client, validating the key up front. `new Anthropic()`
 * throws synchronously if the key is unresolved; doing it here with a clear
 * message (and trimming stray whitespace/newlines from a pasted key) makes the
 * failure obvious in logs instead of a vague constructor error.
 */
function getClient(): Anthropic {
  // Strip ALL whitespace — a line-wrapped paste embeds newlines inside the key
  // which throw "invalid header value" (.trim() only handles trailing ones).
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").replace(/\s/g, "");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing or empty in the server environment.");
  }
  return new Anthropic({ apiKey });
}

/**
 * Log the full detail of an SDK/API failure (status, name, message, response
 * body) and return a concise Error whose message is safe to surface upstream.
 */
function wrapApiError(context: string, err: unknown): Error {
  if (err instanceof Anthropic.APIError) {
    const body =
      typeof err.error === "object" ? JSON.stringify(err.error) : String(err.error ?? "");
    console.error(
      `[underwriting] ${context}: Anthropic APIError status=${err.status} name=${err.name} message=${err.message} body=${body}`,
    );
    return new Error(`Anthropic ${err.status ?? "?"} ${err.name}: ${err.message}`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[underwriting] ${context}: ${msg}`);
  return err instanceof Error ? err : new Error(msg);
}

/** Map the deal tier to the legacy recommendation enum (for email + AiTab). */
function recommendationFromTier(tier?: string): Recommendation {
  const t = (tier ?? "").toLowerCase();
  if (t.startsWith("pass")) return "decline";
  if (t.startsWith("watch")) return "proceed_with_conditions";
  return "proceed";
}

/**
 * Shared call. Uses the web_search server tool (to pull rental comps before
 * scoring STAB) + the submit_underwriting custom tool. tool_choice is "auto"
 * so the model can search first, then submit — forcing a tool would block the
 * search. Returns the validated structured output.
 */
async function callUnderwriting(
  content: Anthropic.ContentBlockParam[],
): Promise<UnderwritingOutput> {
  const client = getClient();
  const tools = [
    { type: "web_search_20250305", name: "web_search" },
    {
      name: "submit_underwriting",
      description: "Submit the extracted deal data and full underwriting analysis.",
      input_schema: TOOL_SCHEMA,
    },
  ] as unknown as Anthropic.MessageCreateParams["tools"];

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    throw wrapApiError("callUnderwriting", err);
  }

  const block = response.content.find(
    (b) => b.type === "tool_use" && b.name === "submit_underwriting",
  );
  if (!block || block.type !== "tool_use") {
    throw new Error("Underwriting model did not return structured output.");
  }
  const out = block.input as UnderwritingOutput;

  // Derive backward-compat fields so existing consumers (email, AiTab) work.
  if (out.underwriting) {
    const uw = out.underwriting as UnderwritingAnalysis;
    uw.summary = uw.ai_summary ?? uw.summary ?? "";
    uw.recommendation = uw.recommendation ?? recommendationFromTier(uw.deal_tier);
    uw.important_flags = uw.important_flags ?? [];
  }
  return out;
}

/** Underwrite from uploaded PDFs (LOI required, deck optional). */
export async function underwriteDeal(
  loi: PdfInput,
  deck?: PdfInput,
): Promise<UnderwritingOutput> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: loi.base64 },
      title: "Letter of Intent",
    },
  ];
  if (deck) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: deck.base64 },
      title: "Deal Deck",
    });
  }
  content.push({
    type: "text",
    text: "Read the attached document(s), extract every deal field, and underwrite this deal. Call submit_underwriting with your complete analysis.",
  });
  return callUnderwriting(content);
}

/** Underwrite from a deal's structured data (manual deals / no PDFs on file). */
export async function underwriteDealData(
  deal: Record<string, unknown>,
): Promise<UnderwritingOutput> {
  return callUnderwriting([
    {
      type: "text",
      text:
        "Underwrite this deal from its structured data. Confirm extracted_deal_data and run the full analysis:\n\n" +
        JSON.stringify(deal, null, 2),
    },
  ]);
}

// ---------------------------------------------------------------------------
// Document update extraction (item 3) — pull milestone dates + term changes
// ---------------------------------------------------------------------------

export interface ExtractedMilestone {
  label: string;
  target_date: string; // YYYY-MM-DD
  milestone_type: "emd" | "inspection" | "coe" | "custom";
}
export interface ExtractedTermChange {
  field: string; // deals column, e.g. "purchase_price"
  label: string; // human label
  suggested_value: number | string | null;
  note: string;
}
export interface DocExtraction {
  milestones: ExtractedMilestone[];
  term_changes: ExtractedTermChange[];
  summary: string;
}

const DOC_SCHEMA = {
  type: "object",
  properties: {
    milestones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          target_date: { type: "string" },
          milestone_type: { type: "string", enum: ["emd", "inspection", "coe", "custom"] },
        },
        required: ["label", "target_date", "milestone_type"],
      },
    },
    term_changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: [
              "purchase_price",
              "arv",
              "loan_amount",
              "seller_note_amount",
              "interest_rate",
              "holdback",
              "lender_name",
              "quote_number",
            ],
          },
          label: { type: "string" },
          suggested_value: { type: ["number", "string", "null"] },
          note: { type: "string" },
        },
        required: ["field", "label", "suggested_value", "note"],
      },
    },
    summary: { type: "string" },
  },
  required: ["milestones", "term_changes", "summary"],
} as const;

const DOC_SYSTEM = `You read real-estate deal documents (contracts, amendments, LOIs, addenda) for Portfolio AI. Extract:
- milestones: key dated deadlines — earnest money (emd), inspection/due-diligence period end (inspection), close of escrow (coe), or other (custom). target_date MUST be ISO YYYY-MM-DD. Only include dates actually present.
- term_changes: any deal economics stated in the document that may differ from the current record — purchase_price, arv, loan_amount, seller_note_amount, interest_rate, holdback, lender_name, quote_number. suggested_value is the value found in the document. Only include terms actually stated.
- summary: one or two sentences on what this document is and what changed.
Use empty arrays if nothing applies. Always call extract_document.`;

/** Extract milestone dates + term changes from a single PDF document. */
export async function extractDocumentUpdates(
  pdfBase64: string,
): Promise<DocExtraction> {
  const client = getClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: DOC_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: "extract_document",
          description: "Submit extracted milestone dates and term changes from the document.",
          input_schema: DOC_SCHEMA as unknown as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: "extract_document" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
              title: "Deal document",
            },
            { type: "text", text: "Extract milestone dates and any deal-term changes. Call extract_document." },
          ],
        },
      ],
    });
  } catch (err) {
    throw wrapApiError("extractDocumentUpdates", err);
  }
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Document extraction returned no structured output.");
  }
  return block.input as DocExtraction;
}
