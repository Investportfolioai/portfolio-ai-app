import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { UnderwritingOutput } from "@/lib/types";

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

const SYSTEM_PROMPT = `You are the AI underwriting engine for Portfolio AI, a real estate deal-structuring firm.

Portfolio AI's model is the "AB→BC" engine: an institutional or private lender funds 70–75% LTV while the seller carries the remaining balance via a subordinate, flexible note — creating an immediate equity spread captured at acquisition. Fees are earned at acquisition. The person who controls the structure controls the equity.

You will receive a deal as either PDF documents (an LOI and optional deck) or as structured JSON data. Read whatever you are given directly.

Your job:
1. EXTRACT every deal field into extracted_deal_data. Use null for anything genuinely absent — never invent values. Money fields are plain numbers (700000, not "$700K"). Rates are percent numbers (9.125), EXCEPT ltv which is a 0–1 ratio. Classify structure_type as one of: morby, ab_bc, assignment, creative, nnn, seller_finance. Classify exit_strategy as: sell, refi, hold, assignment. Include total_cash_invested (sponsor cash deployed) and net_monthly_cashflow (monthly income − opex − ALL debt service; NEGATIVE = monthly carry/outflow, POSITIVE = cash flowing) — these drive the Capital Runway Multiple. If they were provided in the input data, carry them through.
2. UNDERWRITE the deal:
   - equity_spread = ARV − loan amount (null if unknown).
   - acquisition_grade (0–100): quality of the entry — spread, LTV vs the 70–75% target, basis vs ARV, fee capture, structural control.
   - stabilization_grade (0–100): quality of the hold/exit — rehab/lease-up risk, exit viability, debt terms, carry runway.
   - recommendation: proceed, proceed_with_conditions, or decline.
   - summary: 2–4 sentences a lender or KP can trust.
   - strengths / risks / conditions: concise bullets.

Be rigorous and honest. Missing data is itself a risk. Always call submit_underwriting.`;

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
        recommendation: {
          type: "string",
          enum: ["proceed", "proceed_with_conditions", "decline"],
        },
        acquisition_grade: { type: "integer" },
        stabilization_grade: { type: "integer" },
        equity_spread: num,
        summary: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        conditions: { type: "array", items: { type: "string" } },
      },
      required: [
        "recommendation",
        "acquisition_grade",
        "stabilization_grade",
        "summary",
        "strengths",
        "risks",
        "conditions",
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

/** Shared call: takes the user content blocks, returns the structured output. */
async function callUnderwriting(
  content: Anthropic.ContentBlockParam[],
): Promise<UnderwritingOutput> {
  const client = getClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [
        {
          name: "submit_underwriting",
          description:
            "Submit the extracted deal data and underwriting analysis for a deal.",
          input_schema: TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: "submit_underwriting" },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    throw wrapApiError("callUnderwriting", err);
  }
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Underwriting model did not return structured output.");
  }
  return block.input as UnderwritingOutput;
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
