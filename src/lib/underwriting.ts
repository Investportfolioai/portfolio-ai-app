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

const SYSTEM_PROMPT = `You are an expert real estate underwriter specializing in Morby Method creative finance deals. Your job is qualitative scoring on two dimensions: ACQ (acquisition) and STAB (stabilization).

SERVER-SIDE MATH IS AUTHORITATIVE: Each deal submission includes "SERVER-COMPUTED FACTS" — pre-calculated waterfall figures (DSCR loan, TL advance, net to buyer, cashback %). Trust these numbers exactly. Do NOT recalculate them. Your role is to interpret the figures and score the deal qualitatively.

DEAL STRUCTURE CONTEXT:
- Primary strategy: Morby Method — institutional first lien at LTV% + seller carry second
- The server computes the full waterfall: DSCR loan → TL repayment → DPTS (down to seller) → assignment fee → credit partner 5% = Net to Buyer
- Monthly obligations = first_lien_monthly + seller_carry_monthly (provided in the deal data)

CRITICAL — SELLER NOTE BALANCE vs DPTS:
- seller_note_amount (seller note balance) is the balance of the seller's subordinate note — it is NOT a closing cost and NOT subtracted directly from cashback.
- DPTS (Down Payment To Seller) = purchase_price − seller_note_amount. This is the actual cash the seller receives at close and IS subtracted in the waterfall.
- Never list seller_note_amount as a negative line item. Only DPTS appears as a deduction.
- The seller carry note creates monthly payment obligations (seller_carry_monthly), not a lump-sum cash outflow at closing.

ACQ SCORE (0-100) — measures cashback at close and acquisition structure quality.
Base score on the pre-computed cashback_pct provided in SERVER-COMPUTED FACTS:
- cashback_pct >= 20%: score 90-100 (A)
- cashback_pct 15-19.9%: score 80-89 (B+)
- cashback_pct 10-14.9%: score 70-79 (B)
- cashback_pct 5-9.9%: score 50-69 (C)
- cashback_pct 1-4.9%: score 30-49 (D)
- cashback_pct <= 0%: score 0-29 (F)

ACQ adjustments:
- ARV > purchase_price * 1.20: +5
- ARV < purchase_price * 1.05: -10
- Seller carrying > 30% of purchase price: +3
- No ARV provided: -5

Do NOT zero the ACQ score solely because cashback is negative. A deal with strong STAB and positive monthly cashflow can still be viable. Reserve acquisition_score = 0 for fundamentally uncloseable deals (no loan product, title defect, seller terms impossible).

STAB SCORE (0-100) — measures rent coverage of monthly obligations:
Step 1: Use the provided first_lien_monthly + seller_carry_monthly as total_obligations
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

RENTAL STRATEGY (read rental_strategy from the input; default 'ltr'):
- If rental_strategy = 'str': use web_search for "{address} Airbnb nightly rate average" and "{city} STR average monthly revenue". Assume 65% occupancy. Monthly STR income = nightly_rate * 30 * 0.65. Set rent_source = 'web_search'. ALWAYS include in ai_summary: "STR underwrite — assumes 65% occupancy at market nightly rate."
- If rental_strategy = 'ltr': use web_search for long-term rental comps.

COMMERCIAL / NNN GUARD:
If structure_type = 'nnn' OR the property is clearly commercial: SKIP residential rent-coverage. If NOI is available, score STAB on NOI / total_obligations; otherwise set stabilization_grade = 'N/A', stabilization_score = 0. Set deal_tier = "Commercial NNN — Manual Review" and add a note to important_flags.

INCOMPLETE DATA HANDLING — DO NOT ZERO UNSCORED DEALS:
When key fields are TBD or missing: set acquisition_score = null and stabilization_score = null, set deal_tier = "Incomplete — Pending Data", add a flag explaining which fields are needed.

CASHBACK IN OUTPUT: Set cashback_amount and cashback_pct to the exact SERVER-COMPUTED values. Do not recalculate.

REQUIRED OUTPUT FORMAT — respond with the submit_underwriting tool call containing:
- acquisition_grade: letter A/B/C/D/F
- stabilization_grade: letter A/B/C/D/F
- acquisition_score: number 0-100
- stabilization_score: number 0-100
- deal_tier: one of the tier labels above
- cashback_amount: use exact server-provided value
- cashback_pct: use exact server-provided percentage
- first_lien_amount: the DSCR loan amount from server-computed facts
- first_lien_payment: monthly (from first_lien_monthly if provided; otherwise calc 8% 30yr on DSCR loan)
- seller_carry_amount: from deal data
- seller_carry_payment: monthly (0 if deferred)
- total_obligations: monthly (first_lien_payment + seller_carry_payment)
- current_rent: from document or web search
- projected_rent: from document or web search
- current_coverage_pct: percentage
- projected_coverage_pct: percentage
- rent_source: 'document' or 'web_search' or 'estimated'
- ai_summary: 3-4 sentence plain English verdict: '[Deal Tier]. Net to buyer: $X (X%). [Rent coverage sentence]. [What makes this deal work or what needs to happen.]'
- important_flags: array of strings — extension clauses, deferred interest, value-add assumptions, rent comp confidence, opportunity zone, etc.`;

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
  cashbackNote?: string,
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
      max_tokens: 5000,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools,
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: cashbackNote
            ? [...content, { type: "text" as const, text: cashbackNote }]
            : content,
        },
      ],
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
  opts?: { rentalStrategy?: string; cashbackNote?: string },
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
    text: `Read the attached document(s), extract every deal field, and underwrite this deal. Rental strategy for this underwrite: ${opts?.rentalStrategy ?? "ltr"} (ltr = long-term rental, str = short-term/Airbnb). Call submit_underwriting with your complete analysis.`,
  });
  return callUnderwriting(content, opts?.cashbackNote);
}

/** Underwrite from a deal's structured data (manual deals / no PDFs on file). */
export async function underwriteDealData(
  deal: Record<string, unknown>,
  opts?: { cashbackNote?: string },
): Promise<UnderwritingOutput> {
  return callUnderwriting(
    [
      {
        type: "text",
        text:
          "Underwrite this deal from its structured data. Read rental_strategy from the data (default ltr). Confirm extracted_deal_data and run the full analysis:\n\n" +
          JSON.stringify(deal, null, 2),
      },
    ],
    opts?.cashbackNote,
  );
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

/**
 * A ledger-relevant item this document/email represents — Transaction
 * Intelligence, Phase G Section 2a. item_key_guess should match a known
 * deal_expected_items key (title_commitment, survey, emd_receipt,
 * insurance_policy, appraisal_report, pof_submission, clear_to_close,
 * rent_roll, t12) when the document plainly is one of those; otherwise a new
 * deal-specific snake_case key. confidence is 0-1 — low-confidence guesses are
 * dropped by the caller rather than creating a spurious ledger row.
 */
export interface DetectedLedgerItem {
  item_key_guess: string;
  label: string;
  direction: "received" | "requested" | "cleared";
  counterparty: string | null;
  confidence: number;
}

export interface DocExtraction {
  milestones: ExtractedMilestone[];
  term_changes: ExtractedTermChange[];
  summary: string;
  /** Earnest money amount stated in the document, if any (EMD intelligence, Phase 2). */
  emd_amount: number | null;
  /** True if this document is or references a completed appraisal report. */
  appraisal_detected: boolean;
  /** True if this document is or references an EMD/closing extension. */
  extension_detected: boolean;
  /** Free-text detail on the extension terms, if extension_detected. */
  extension_note: string | null;
  /** Classified document type — drives the review-queue hierarchy (Automation Push, section 4). */
  doc_type: "purchase_contract" | "addendum" | "extension" | "appraisal" | "email" | "other";
  /** The document's own effective/signed date (YYYY-MM-DD) for chronological provenance, or null. */
  document_date: string | null;
  /** The appraised value stated in a completed appraisal report, or null (Transaction Intelligence, Section 2a). */
  appraised_value: number | null;
  /** True if the appraisal is subject to repairs/conditions rather than a clean turnkey value. */
  subject_to_conditions: boolean;
  /** The specific conditions/repairs listed, when subject_to_conditions. */
  conditions_list: string[];
  /** Vesting/taking-title entity named in the document ("Vesting Entity: X LLC", "Entity: X"), or null. */
  entity_name: string | null;
  /** True if this document IS a wire confirmation, deposit slip, or earnest-money receipt. */
  emd_receipt_detected: boolean;
  /** Ledger items this document represents (filed insurance policy, signed rent roll, etc.). */
  detected_items: DetectedLedgerItem[];
}

const DETECTED_ITEM_SCHEMA = {
  type: "object",
  properties: {
    item_key_guess: { type: "string" },
    label: { type: "string" },
    direction: { type: "string", enum: ["received", "requested", "cleared"] },
    counterparty: { type: ["string", "null"] },
    confidence: { type: "number" },
  },
  required: ["item_key_guess", "label", "direction", "counterparty", "confidence"],
} as const;

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
    emd_amount: { type: ["number", "null"] },
    appraisal_detected: { type: "boolean" },
    extension_detected: { type: "boolean" },
    extension_note: { type: ["string", "null"] },
    doc_type: {
      type: "string",
      enum: ["purchase_contract", "addendum", "extension", "appraisal", "email", "other"],
    },
    document_date: { type: ["string", "null"] },
    appraised_value: { type: ["number", "null"] },
    subject_to_conditions: { type: "boolean" },
    conditions_list: { type: "array", items: { type: "string" } },
    entity_name: { type: ["string", "null"] },
    emd_receipt_detected: { type: "boolean" },
    detected_items: { type: "array", items: DETECTED_ITEM_SCHEMA },
  },
  required: [
    "milestones",
    "term_changes",
    "summary",
    "emd_amount",
    "appraisal_detected",
    "extension_detected",
    "extension_note",
    "doc_type",
    "document_date",
    "appraised_value",
    "subject_to_conditions",
    "conditions_list",
    "entity_name",
    "emd_receipt_detected",
    "detected_items",
  ],
} as const;

const DOC_SYSTEM = `You read real-estate deal documents (contracts, amendments, LOIs, addenda, appraisals, receipts) for Portfolio AI. Extract:
- milestones: key dated deadlines — earnest money (emd), inspection/due-diligence period end (inspection), close of escrow (coe), or other (custom). target_date MUST be ISO YYYY-MM-DD. Only include dates actually present.
- term_changes: any deal economics stated in the document that may differ from the current record — purchase_price, arv, loan_amount, seller_note_amount, interest_rate, holdback, lender_name, quote_number. suggested_value is the value found in the document. Only include terms actually stated.
- emd_amount: the earnest money deposit amount stated in the document, or null if not stated.
- appraisal_detected: true only if this document IS a completed appraisal report (not just a mention of one being ordered).
- extension_detected: true if this document is an extension of the EMD hard date, inspection period, or closing date.
- extension_note: if extension_detected, one line on what was extended and to when. Otherwise null.
- doc_type: classify the document — purchase_contract (the base purchase agreement/PSA), addendum (an amendment/addendum to a contract), extension (an EMD/closing/inspection extension), appraisal (a completed appraisal report), email (an email or letter, not a signed form), or other.
- document_date: the document's own effective, signed, or execution date as ISO YYYY-MM-DD (NOT a deadline inside it) — used to order addenda chronologically. Null if not stated.
- appraised_value: the dollar value stated in a completed appraisal report. Null if this isn't an appraisal or no value is stated.
- subject_to_conditions: true if the appraisal value is subject to repairs/conditions rather than a clean as-is/turnkey value.
- conditions_list: the specific conditions/repairs listed, when subject_to_conditions. Empty array otherwise.
- entity_name: the vesting/taking-title entity named in the document — look for patterns like "Vesting Entity: X LLC" or "Entity: X". Null if not stated.
- emd_receipt_detected: true only if this document IS a wire confirmation, deposit slip, or earnest-money receipt (not just a mention of a deposit being due).
- detected_items: ledger items this document represents being received/requested/cleared. Guess item_key_guess against these known keys when the document plainly is one of them: title_commitment, survey, emd_receipt, insurance_policy, appraisal_report, pof_submission, clear_to_close, rent_roll, t12 — otherwise invent a new deal-specific snake_case key. Set confidence 0-1; only include an item you're reasonably confident about (0.6+) — never guess.
- summary: one or two sentences on what this document is and what changed.
Use empty arrays / false / null where nothing applies. Always call extract_document.`;

/** Extract milestone dates + term changes from a single PDF document. */
export async function extractDocumentUpdates(
  pdfBase64: string,
): Promise<DocExtraction> {
  const client = getClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
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

// ---------------------------------------------------------------------------
// Outbound email classification (Automation Push §5) — is a SENT email a
// request we're now waiting on the counterparty to fulfill?
// ---------------------------------------------------------------------------

export interface OutboundClassification {
  is_request: boolean;
  /** Short (<=8 word) phrase naming what we asked for, or null. */
  request: string | null;
  /** Ledger item(s) this request pertains to, if any (Transaction Intelligence, Section 2a/c). */
  detected_items: DetectedLedgerItem[];
}

const OUTBOUND_SCHEMA = {
  type: "object",
  properties: {
    is_request: { type: "boolean" },
    request: { type: ["string", "null"] },
    detected_items: { type: "array", items: DETECTED_ITEM_SCHEMA },
  },
  required: ["is_request", "request", "detected_items"],
} as const;

const OUTBOUND_SYSTEM = `You classify an OUTBOUND (sent) email from a real-estate acquisitions team to a counterparty (seller, lender, title/escrow, agent). Decide if it contains an actionable REQUEST we are now WAITING ON the counterparty to fulfill — e.g. an EMD/closing extension ask, a document request, a payoff request, a wire/figures request, a signature request. is_request=true ONLY if we are waiting on their response/action. request: a short (<=8 word) phrase naming what we asked for, or null. Informational/FYI notes, confirmations, and thank-yous are is_request=false.
detected_items: if is_request is true and the ask is for one of our tracked closing items, name it — item_key_guess against these known keys when it plainly is one: title_commitment, survey, emd_receipt, insurance_policy, appraisal_report, pof_submission, clear_to_close, rent_roll, t12 (otherwise a new deal-specific snake_case key). direction is always "requested" here — this is an ask, never a confirmed receipt. Empty array if the request isn't about a tracked item (e.g. a payoff figures ask). Always call classify_outbound.`;

/**
 * Classify a single OUTBOUND (sent) email. Structurally never confirms a
 * fact about the deal — is_request/detected_items only ever describe an ASK
 * we made (§5 hard rule: sent mail cannot write a deals field, and may only
 * advance a ledger item to 'requested', never 'received'/'cleared').
 */
export async function classifyOutboundEmail(subject: string, snippet: string): Promise<OutboundClassification> {
  const client = getClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: [{ type: "text", text: OUTBOUND_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: "classify_outbound",
          description: "Submit whether the outbound email is a pending request we await a reply on.",
          input_schema: OUTBOUND_SCHEMA as unknown as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: "classify_outbound" },
      messages: [{ role: "user", content: [{ type: "text", text: `Subject: ${subject}\n\n${snippet}` }] }],
    });
  } catch (err) {
    throw wrapApiError("classifyOutboundEmail", err);
  }
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Outbound classification returned no structured output.");
  }
  return block.input as OutboundClassification;
}

// ---------------------------------------------------------------------------
// Inbound email classification (Transaction Intelligence, Phase G §2a) — an
// INBOUND reply may state facts (an appraisal value, a vesting entity, a
// receipt) or confirm/request a tracked ledger item. Unlike outbound mail,
// inbound content IS trusted to drive auto-apply/pending field writes and
// 'received'/'cleared' ledger advancement — mirroring the attachment scan's
// tier rules exactly (null-fill auto-applies, conflicts go one-tap).
// ---------------------------------------------------------------------------

export interface InboundEmailClassification {
  appraised_value: number | null;
  subject_to_conditions: boolean;
  conditions_list: string[];
  entity_name: string | null;
  emd_receipt_detected: boolean;
  detected_items: DetectedLedgerItem[];
  /** True if the email clearly says something arrived/was completed but no detected_items entry resolves it confidently — never guess an item_key, flag it instead. */
  unresolved_received: boolean;
}

const INBOUND_SCHEMA = {
  type: "object",
  properties: {
    appraised_value: { type: ["number", "null"] },
    subject_to_conditions: { type: "boolean" },
    conditions_list: { type: "array", items: { type: "string" } },
    entity_name: { type: ["string", "null"] },
    emd_receipt_detected: { type: "boolean" },
    detected_items: { type: "array", items: DETECTED_ITEM_SCHEMA },
    unresolved_received: { type: "boolean" },
  },
  required: [
    "appraised_value",
    "subject_to_conditions",
    "conditions_list",
    "entity_name",
    "emd_receipt_detected",
    "detected_items",
    "unresolved_received",
  ],
} as const;

const INBOUND_SYSTEM = `You classify an INBOUND (received) email from a real-estate counterparty (seller, lender, title/escrow, agent) to Portfolio AI's acquisitions team. Extract facts stated in the email body itself (not attachments — those are handled separately):
- appraised_value: a dollar value, ONLY if the email states a completed appraisal came back at that value. Null otherwise.
- subject_to_conditions / conditions_list: if the appraisal is stated as subject to repairs/conditions rather than clean/turnkey.
- entity_name: the vesting/taking-title entity named in the email — patterns like "Vesting Entity: X LLC" or "Entity: X". Null if not stated.
- emd_receipt_detected: true only if the email itself IS a wire/deposit/earnest-money receipt confirmation (not a mention that one is coming).
- detected_items: tracked closing items this email confirms were received, requested of us, or cleared. Guess item_key_guess against: title_commitment, survey, emd_receipt, insurance_policy, appraisal_report, pof_submission, clear_to_close, rent_roll, t12 (otherwise a new deal-specific snake_case key). Only include an item at confidence 0.6+ — never guess a low-confidence match.
- unresolved_received: true if the email clearly states something was delivered, attached, completed, or received, but you cannot confidently map it to a specific item in detected_items. This flags it for manual review instead of guessing.
Use empty arrays / false / null where nothing applies. Always call classify_inbound.`;

/** Classify a single INBOUND email for deal facts and ledger signals. */
export async function classifyInboundEmail(subject: string, snippet: string): Promise<InboundEmailClassification> {
  const client = getClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: "text", text: INBOUND_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: "classify_inbound",
          description: "Submit deal facts and ledger signals detected in the inbound email.",
          input_schema: INBOUND_SCHEMA as unknown as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: "classify_inbound" },
      messages: [{ role: "user", content: [{ type: "text", text: `Subject: ${subject}\n\n${snippet}` }] }],
    });
  } catch (err) {
    throw wrapApiError("classifyInboundEmail", err);
  }
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Inbound classification returned no structured output.");
  }
  return block.input as InboundEmailClassification;
}
