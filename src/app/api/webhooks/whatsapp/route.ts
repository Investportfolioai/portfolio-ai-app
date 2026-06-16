/**
 * Twilio WhatsApp webhook receiver.
 *
 * SETUP REQUIRED before live messages can be sent or received:
 *   1. Add to .env.local:
 *        TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *        TWILIO_AUTH_TOKEN=your_auth_token
 *        TWILIO_WHATSAPP_FROM=whatsapp:+14155238886   (or your approved number)
 *   2. In Twilio Console → Messaging → Settings → WhatsApp Sandbox (or Production):
 *        Webhook URL: https://your-domain.com/api/webhooks/whatsapp
 *        HTTP Method: POST
 *
 * The webhook receives inbound WhatsApp messages, matches them to deals,
 * and stores them for surfacing in the Lending detail view.
 * It will NOT send replies until credentials are configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

/**
 * Validate Twilio webhook signature to prevent spoofed requests.
 * Returns true when credentials are not configured (dev mode — accept all).
 */
async function validateTwilioSignature(req: NextRequest, body: string): Promise<boolean> {
  if (!isTwilioConfigured()) return true;

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const url = req.url;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;

  const { validateRequest } = await import("twilio");
  const params: Record<string, string> = {};
  new URLSearchParams(body).forEach((v, k) => { params[k] = v; });

  return validateRequest(authToken, signature, url, params);
}

/**
 * Match an inbound WhatsApp message to a deal by scanning property addresses.
 * Returns the first deal whose address appears in the message body.
 */
async function matchMessageToDeal(
  messageBody: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  const { data: deals } = await supabase
    .from("deals")
    .select("id, property_address")
    .in("status", ["active", "pending"]);

  if (!deals?.length) return null;

  const lower = messageBody.toLowerCase();
  for (const deal of deals as { id: string; property_address: string }[]) {
    const addressWords = deal.property_address
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((w) => w.length > 3);
    const matched = addressWords.filter((w) => lower.includes(w)).length;
    if (matched >= 2) return deal.id;
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  const valid = await validateTwilioSignature(req, body);
  if (!valid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const params = Object.fromEntries(new URLSearchParams(body));
  const from: string = params.From ?? "";
  const messageBody: string = params.Body ?? "";
  const messageSid: string = params.MessageSid ?? "";

  if (!messageBody) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  const supabase = createAdminClient();
  const dealId = await matchMessageToDeal(messageBody, supabase);

  // Store the message for later surfacing in the Lending view
  await supabase.from("whatsapp_messages").upsert(
    {
      message_sid: messageSid,
      from_number: from,
      body: messageBody,
      deal_id: dealId,
      direction: "inbound",
      received_at: new Date().toISOString(),
    },
    { onConflict: "message_sid" },
  );

  // Respond with empty TwiML — do not auto-reply until the operator reviews
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}
