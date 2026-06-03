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
 * AI underwriting engine. Sends the wholesaler's LOI (and optional deal deck)
 * to Claude as base64 PDF documents; Claude reads them directly, extracts the
 * deal fields, and underwrites the deal — returning structured JSON.
 *
 * Model: claude-opus-4-8. Structured output is forced via a single tool call
 * (GA path; `output_config.format` is beta-only in this SDK version). Forced
 * tool_choice and extended thinking are mutually exclusive, so the reasoning is
 * captured as fields in the schema instead.
 */

const MODEL = "claude-opus-4-8";

export interface PdfInput {
  base64: string;
}

const SYSTEM_PROMPT = `You are the AI underwriting engine for Portfolio AI, a real estate deal-structuring firm.

Portfolio AI's model is the "AB→BC" engine: an institutional or private lender funds 70–75% LTV while the seller carries the remaining balance via a subordinate, flexible note — creating an immediate equity spread captured at acquisition. Fees are earned at acquisition (assignment, origination, structuring). The person who controls the structure controls the equity.

You will receive a wholesaler's Letter of Intent (LOI) and, optionally, a deal deck — both as PDF documents. Read them directly.

Your job:
1. EXTRACT every deal field present in the documents into extracted_deal_data. Use null for anything genuinely absent — never invent values. Money fields are plain numbers (e.g. 700000, not "$700K"). Rates are percent numbers (e.g. 9.125 means 9.125%), EXCEPT ltv which is a 0–1 ratio (e.g. 0.53). Classify structure_type as one of: morby, ab_bc, assignment, creative, nnn. Classify exit_strategy as one of: sell, refi, hold, assignment.
2. UNDERWRITE the deal:
   - equity_spread = ARV − loan amount (null if either is unknown).
   - total_cash_invested: total cash the sponsor deploys into the deal (down payment/cash-to-close + fees paid in + reserves). null if not determinable.
   - net_monthly_cashflow: monthly income minus operating expenses minus ALL debt service. NEGATIVE means a monthly cash outflow (carry); POSITIVE means the deal cash-flows. null if not determinable. This drives the Capital Runway Multiple (cash invested ÷ monthly outflow).
   - acquisition_grade (0–100): quality of the entry — spread, LTV vs the 70–75% target, basis vs ARV, fee capture, structural control.
   - stabilization_grade (0–100): quality of the hold/exit — rehab/lease-up risk, exit viability, debt terms, carry runway.
   - recommendation: proceed (strong), proceed_with_conditions (workable with specific fixes), or decline (does not pencil).
   - summary: 2–4 sentences a lender or KP can trust.
   - strengths / risks / conditions: concise bullets (conditions = what must be true to proceed).

Be rigorous and honest. Missing data is itself a risk — note it. Always call submit_underwriting with your complete analysis.`;

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
          enum: ["morby", "ab_bc", "assignment", "creative", "nnn", null],
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
        total_cash_invested: num,
        net_monthly_cashflow: num,
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

/** Run the full extract + underwrite pass on the uploaded PDFs. */
export async function underwriteDeal(
  loi: PdfInput,
  deck?: PdfInput,
): Promise<UnderwritingOutput> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [
      {
        name: "submit_underwriting",
        description:
          "Submit the extracted deal data and underwriting analysis for a wholesaler-submitted deal.",
        input_schema: TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: "submit_underwriting" },
    messages: [{ role: "user", content }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Underwriting model did not return structured output.");
  }
  return block.input as UnderwritingOutput;
}
