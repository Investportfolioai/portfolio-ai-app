import "server-only";
import { Resend } from "resend";

/**
 * Channel-agnostic reminder delivery. Email-only today; a "whatsapp" channel
 * can be appended to the array once Twilio credentials exist (Phase 3) without
 * touching call sites.
 */
export type ReminderChannel = "email" | "whatsapp";

export interface ReminderMessage {
  subject: string;
  html: string;
  /** Recipients for the email channel; defaults to the standard alert list. */
  to?: string[];
}

const DEFAULT_TO = ["john@investportfolio.ai", "loa@investportfolio.ai"];
const FROM = "Portfolio AI <deals@mail.investportfolio.ai>";

async function sendEmail(message: ReminderMessage): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY missing — skipping reminder email.");
    return;
  }
  const resend = new Resend(key);
  await resend.emails.send({
    from: FROM,
    to: message.to ?? DEFAULT_TO,
    subject: message.subject,
    html: message.html,
  });
}

async function sendWhatsApp(_message: ReminderMessage): Promise<void> {
  throw new Error("WhatsApp reminders are not configured yet — Twilio credentials are missing.");
}

/** Send a reminder over one or more channels. Defaults to email only. */
export async function sendReminder(
  message: ReminderMessage,
  channels: ReminderChannel[] = ["email"],
): Promise<void> {
  for (const channel of channels) {
    if (channel === "email") await sendEmail(message);
    else if (channel === "whatsapp") await sendWhatsApp(message);
  }
}
