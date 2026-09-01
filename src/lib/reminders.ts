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
  /**
   * ISO 8601 timestamp for Resend scheduled send (delayed delivery). Omit to
   * send immediately. Ignored by non-email channels.
   */
  scheduledAt?: string;
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
    ...(message.scheduledAt ? { scheduledAt: message.scheduledAt } : {}),
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

/**
 * Send an email-channel reminder (typically a scheduled send via scheduledAt)
 * and return the Resend message id so a pending scheduled send can be
 * cancelled later. Returns null if email was skipped or the API rejected it.
 */
export async function scheduleReminderEmail(message: ReminderMessage): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY missing — skipping scheduled reminder email.");
    return null;
  }
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: message.to ?? DEFAULT_TO,
    subject: message.subject,
    html: message.html,
    ...(message.scheduledAt ? { scheduledAt: message.scheduledAt } : {}),
  });
  if (error) {
    console.error("scheduleReminderEmail failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Best-effort cancel of a Resend scheduled email. Never throws — a stale id
 * (email already sent/processing) just logs and moves on.
 */
export async function cancelScheduledEmail(id: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    const resend = new Resend(key);
    await resend.emails.cancel(id);
  } catch (e) {
    console.warn("cancelScheduledEmail failed (may have already sent):", (e as Error).message);
  }
}
