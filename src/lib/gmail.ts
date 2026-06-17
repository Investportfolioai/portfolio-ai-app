import "server-only";

/**
 * Gmail API client for the Portfolio AI app.
 *
 * Requires these env vars (add to .env.local):
 *   GMAIL_CLIENT_ID       — Google OAuth2 client ID
 *   GMAIL_CLIENT_SECRET   — Google OAuth2 client secret
 *   GMAIL_REFRESH_TOKEN   — Offline refresh token for john@investportfolio.ai
 *
 * To generate the refresh token:
 *   1. Create an OAuth2 client in Google Cloud Console (redirect: http://localhost)
 *   2. Enable the Gmail API on that project
 *   3. Use the OAuth2 Playground (https://developers.google.com/oauthplayground)
 *      with scope: https://www.googleapis.com/auth/gmail.modify
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
