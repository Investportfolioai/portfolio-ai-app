import "server-only";
import type { gmail_v1 } from "googleapis";

/**
 * Gmail API client for the Portfolio AI app.
 *
 * Requires these env vars (add to .env.local):
 *   GMAIL_CLIENT_ID       — Google OAuth2 client ID
 *   GMAIL_CLIENT_SECRET   — Google OAuth2 client secret
 *   GMAIL_REFRESH_TOKEN   — Offline refresh token for john@investportfolio.ai
 *
 * As of 2026-08-02 the live token carries gmail.readonly only — sufficient
 * for searchAttachmentCandidates/listPdfAttachments/fetchAttachmentBytes/
 * searchDealThreads, all reads. createGmailDraftReply below calls
 * drafts.create, which needs gmail.compose or gmail.modify — it will 403
 * under the current readonly-only token until re-scoped.
 *
 * To generate a refresh token:
 *   1. Create an OAuth2 client in Google Cloud Console (redirect: http://localhost)
 *   2. Enable the Gmail API on that project
 *   3. Use the OAuth2 Playground (https://developers.google.com/oauthplayground)
 *      with the scope(s) needed for the functions you're using
 *   4. Paste the refresh token into GMAIL_REFRESH_TOKEN
 */

export function isGmailConfigured(): boolean {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
}

export interface GmailThread {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  unread: boolean;
}

/**
 * Search Gmail for threads matching the deal's lender domain and address.
 * Returns an empty array (not an error) when credentials are not configured.
 */
export async function searchDealThreads(params: {
  lenderName: string | null;
  propertyAddress: string;
}): Promise<GmailThread[]> {
  if (!isGmailConfigured()) return [];

  // Build search query: lender name + property address keywords
  const terms: string[] = [];
  if (params.lenderName) terms.push(`"${params.lenderName}"`);
  const addressWords = params.propertyAddress.split(/[\s,]+/).filter((w) => w.length > 3);
  if (addressWords.length) terms.push(`"${addressWords.slice(0, 3).join(" ")}"`);

  const q = terms.length ? terms.join(" OR ") : params.propertyAddress;

  try {
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const listRes = await gmail.users.threads.list({
      userId: "me",
      q,
      maxResults: 10,
    });

    const threads = listRes.data.threads ?? [];
    if (!threads.length) return [];

    const full = await Promise.all(
      threads.map((t) =>
        gmail.users.threads.get({ userId: "me", id: t.id!, format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"] }),
      ),
    );

    return full.map((r) => {
      const msg = r.data.messages?.[0];
      const headers = msg?.payload?.headers ?? [];
      const h = (name: string) => headers.find((hh) => hh.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
      const labelIds = msg?.labelIds ?? [];
      return {
        id: r.data.id ?? "",
        subject: h("Subject") || "(no subject)",
        from: h("From"),
        snippet: r.data.messages?.slice(-1)[0]?.snippet ?? "",
        date: h("Date"),
        unread: labelIds.includes("UNREAD"),
      };
    });
  } catch (e) {
    console.error("Gmail search failed:", e);
    return [];
  }
}

export interface GmailAttachmentCandidate {
  messageId: string;
  subject: string;
  snippet: string;
  internalDate: string; // epoch ms, as returned by the Gmail API
}

const ATTACHMENT_SCAN_QUERY =
  'has:attachment filename:pdf newer_than:14d ' +
  '(subject:(contract OR addendum OR PSA OR "purchase agreement" OR appraisal OR extension OR EMD OR earnest) ' +
  'OR filename:(contract OR addendum OR PSA OR appraisal OR extension OR emd OR earnest))';

/**
 * Search for messages with a PDF attachment matching contract/addendum/
 * appraisal/extension/EMD keywords in the subject or filename. Returns
 * lightweight metadata only (no attachment bytes) — the caller matches
 * against a deal before spending anything on a full fetch or download.
 * Oldest first, so a backlog drains in order. Empty when not configured.
 */
export async function searchAttachmentCandidates(): Promise<GmailAttachmentCandidate[]> {
  if (!isGmailConfigured()) return [];

  try {
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: ATTACHMENT_SCAN_QUERY,
      maxResults: 25,
    });
    const messages = listRes.data.messages ?? [];
    if (!messages.length) return [];

    const full = await Promise.all(
      messages.map((m) =>
        gmail.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["Subject"],
        }),
      ),
    );

    return full
      .map((r) => {
        const headers = r.data.payload?.headers ?? [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
        return {
          messageId: r.data.id ?? "",
          subject,
          snippet: r.data.snippet ?? "",
          internalDate: r.data.internalDate ?? "0",
        };
      })
      .sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  } catch (e) {
    console.error("Gmail attachment search failed:", e);
    return [];
  }
}

export interface GmailPdfAttachment {
  attachmentId: string;
  filename: string;
}

/** Recursively collect PDF parts — attachments can be nested under multipart/* parents. */
function collectPdfParts(parts: gmail_v1.Schema$MessagePart[] | undefined): GmailPdfAttachment[] {
  const found: GmailPdfAttachment[] = [];
  for (const part of parts ?? []) {
    if (part.mimeType === "application/pdf" && part.body?.attachmentId) {
      found.push({ attachmentId: part.body.attachmentId, filename: part.filename || "attachment.pdf" });
    }
    if (part.parts?.length) found.push(...collectPdfParts(part.parts));
  }
  return found;
}

/** Enumerate PDF attachments on a message. Only called after a deal match is confirmed. */
export async function listPdfAttachments(messageId: string): Promise<GmailPdfAttachment[]> {
  if (!isGmailConfigured()) return [];
  try {
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    return collectPdfParts(res.data.payload?.parts);
  } catch (e) {
    console.error(`Gmail list attachments failed for ${messageId}:`, e);
    return [];
  }
}

/** Download and decode a single attachment's PDF bytes. Null on failure. */
export async function fetchAttachmentBytes(
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  if (!isGmailConfigured()) return null;
  try {
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const res = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
    if (!res.data.data) return null;
    return Buffer.from(res.data.data, "base64url");
  } catch (e) {
    console.error(`Gmail attachment fetch failed for ${messageId}/${attachmentId}:`, e);
    return null;
  }
}

/**
 * Create a draft reply to a Gmail thread.
 * Returns null (not an error) when credentials are not configured.
 */
export async function createGmailDraftReply(params: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ draftId: string } | null> {
  if (!isGmailConfigured()) return null;

  const { google } = await import("googleapis");
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const raw = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    params.body,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  try {
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw: encoded, threadId: params.threadId },
      },
    });
    return { draftId: res.data.id ?? "" };
  } catch (e) {
    console.error("Gmail draft creation failed:", e);
    return null;
  }
}
