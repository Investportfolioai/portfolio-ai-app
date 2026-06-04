import "server-only";
import { Resend } from "resend";
import {
  RECOMMENDATION_LABELS,
  STRUCTURE_LABELS,
  type DealStructure,
  type Recommendation,
} from "@/lib/types";

/**
 * Transactional email via Resend. Sends from the investportfolio.ai domain
 * (verify it in Resend after deploy) to the owner inbox.
 */
const FROM = "Portfolio AI <deals@mail.investportfolio.ai>";
const TO = "john@investportfolio.ai";
// Replies to any outbound mail route to the Portfolio AI principals.
// (Resend's SDK maps `replyTo` to the `reply_to` API field.)
const REPLY_TO = ["john@investportfolio.ai", "loa@investportfolio.ai"];

export interface SubmissionEmail {
  submitterName: string;
  submitterEmail: string;
  submitterPhone: string;
  propertyAddress: string;
  acquisitionGrade: number | null;
  stabilizationGrade: number | null;
  recommendation: Recommendation;
  summary: string;
}

/** Notify the owner when a wholesaler submits a deal. Best-effort. */
export async function sendSubmissionNotification(
  data: SubmissionEmail,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping submission email.");
    return;
  }

  const resend = new Resend(key);
  const grade = (g: number | null) => (g == null ? "—" : `${g}/100`);
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#0a0a0a;line-height:1.6">
      <h2 style="color:#0f1c3f;margin:0 0 4px">New deal submission</h2>
      <p style="color:#6e6e73;margin:0 0 16px">${data.propertyAddress}</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:2px 16px 2px 0;color:#6e6e73">Submitter</td><td>${data.submitterName || "—"}</td></tr>
        <tr><td style="padding:2px 16px 2px 0;color:#6e6e73">Email</td><td>${data.submitterEmail || "—"}</td></tr>
        <tr><td style="padding:2px 16px 2px 0;color:#6e6e73">Phone</td><td>${data.submitterPhone || "—"}</td></tr>
        <tr><td style="padding:2px 16px 2px 0;color:#6e6e73">ACQ grade</td><td><b>${grade(data.acquisitionGrade)}</b></td></tr>
        <tr><td style="padding:2px 16px 2px 0;color:#6e6e73">STAB grade</td><td><b>${grade(data.stabilizationGrade)}</b></td></tr>
        <tr><td style="padding:2px 16px 2px 0;color:#6e6e73">Recommendation</td><td><b style="color:#d4af37">${RECOMMENDATION_LABELS[data.recommendation]}</b></td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:14px">${data.summary}</p>
    </div>`;

  await resend.emails.send({
    from: FROM,
    to: TO,
    replyTo: REPLY_TO,
    subject: `New deal submission — ${data.propertyAddress}`,
    html,
  });
}

export type WholesalerResponseKind = "accepted" | "rejected" | "negotiate";

/**
 * Email the wholesaler who submitted a deal with Portfolio AI's response.
 * Sends from deals@mail.investportfolio.ai. Best-effort — never throws.
 */
export async function sendWholesalerResponse(params: {
  to: string;
  propertyAddress: string;
  kind: WholesalerResponseKind;
  message?: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !params.to) {
    console.warn("RESEND_API_KEY / submitter email missing — skipping wholesaler email.");
    return;
  }
  const addr = params.propertyAddress || "your deal";

  let subject: string;
  let body: string;
  if (params.kind === "accepted") {
    subject = `Moving forward — ${addr}`;
    body = `<p style="margin:0 0 16px">Thank you for bringing <b>${addr}</b> to Portfolio AI.</p>
      <p style="margin:0 0 16px">We've completed our review and are moving forward with this deal. Our team will be in touch shortly with next steps.</p>`;
  } else if (params.kind === "rejected") {
    subject = `Update on ${addr}`;
    body = `<p style="margin:0 0 16px">Thank you for submitting <b>${addr}</b> to Portfolio AI.</p>
      <p style="margin:0 0 16px">After careful review, we're passing on this opportunity at this time. We appreciate you thinking of us and welcome future deals.</p>`;
  } else {
    subject = `Let's discuss — ${addr}`;
    const note = (params.message ?? "").trim();
    body = `<p style="margin:0 0 16px">Thank you for submitting <b>${addr}</b> to Portfolio AI.</p>
      <p style="margin:0 0 16px">We're interested in this deal and would like to discuss the terms.</p>
      ${note ? `<div style="margin:0 0 16px;border-left:3px solid #d4af37;padding:4px 0 4px 14px;color:#0a0a0a;white-space:pre-wrap">${escapeHtml(note)}</div>` : ""}
      <p style="margin:0 0 16px">Reply to this email and we'll set up a time to connect.</p>`;
  }

  const html = `
    <div style="font-family:system-ui,sans-serif;color:#0a0a0a;line-height:1.6;max-width:560px">
      <h2 style="color:#0f1c3f;margin:0 0 16px">Portfolio AI</h2>
      ${body}
      <p style="margin:24px 0 0;color:#6e6e73;font-size:13px">— The Portfolio AI team</p>
    </div>`;

  const resend = new Resend(key);
  await resend.emails.send({ from: FROM, to: params.to, replyTo: REPLY_TO, subject, html });
}

/** Minimal HTML escaping for user-entered text embedded in an email. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface KpDealBrief {
  kpEmail: string;
  kpName: string | null;
  assignmentId: string;
  propertyAddress: string;
  structureType: DealStructure;
  purchasePrice: number | null;
  arv: number | null;
  acquisitionGrade: number | null;
  stabilizationGrade: number | null;
  aiSummary: string;
}

/**
 * Send a KP a deal brief with Accept / Decline links. Links carry the
 * assignment id and resolve at /kp/respond. Best-effort.
 */
export async function sendKpDealBrief(brief: KpDealBrief): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !brief.kpEmail) {
    console.warn("RESEND_API_KEY / KP email missing — skipping deal brief.");
    return;
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const accept = `${base}/kp/respond?id=${brief.assignmentId}&action=accepted`;
  const decline = `${base}/kp/respond?id=${brief.assignmentId}&action=declined`;
  const money = (n: number | null) =>
    n == null ? "—" : `$${n.toLocaleString("en-US")}`;
  const grade = (g: number | null) => (g == null ? "—" : `${g}/100`);

  const resend = new Resend(key);
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#0a0a0a;line-height:1.6;max-width:560px">
      <h2 style="color:#0f1c3f;margin:0 0 4px">New deal for your review</h2>
      <p style="color:#6e6e73;margin:0 0 16px">${brief.kpName ? `Hi ${brief.kpName} — ` : ""}you've been invited as a Key Principal on this deal.</p>
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Property</td><td><b>${brief.propertyAddress}</b></td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Structure</td><td>${STRUCTURE_LABELS[brief.structureType] ?? brief.structureType}</td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Purchase price</td><td>${money(brief.purchasePrice)}</td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">ARV</td><td>${money(brief.arv)}</td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Acquisition grade</td><td><b>${grade(brief.acquisitionGrade)}</b></td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Stabilization grade</td><td><b>${grade(brief.stabilizationGrade)}</b></td></tr>
      </table>
      ${brief.aiSummary ? `<p style="font-size:14px;margin:0 0 20px">${brief.aiSummary}</p>` : ""}
      <table style="border-collapse:collapse"><tr>
        <td style="padding-right:12px"><a href="${accept}" style="background:#0f1c3f;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Accept</a></td>
        <td><a href="${decline}" style="background:#f2f2f4;color:#0a0a0a;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Decline</a></td>
      </tr></table>
    </div>`;

  await resend.emails.send({
    from: FROM,
    to: brief.kpEmail,
    replyTo: REPLY_TO,
    subject: `Deal for your review — ${brief.propertyAddress}`,
    html,
  });
}

export interface DeadlineAlert {
  deal_address: string;
  label: string;
  target_date: string;
  days: number;
}

/** Daily digest of milestones coming due (10/5/2 days out). Best-effort. */
export async function sendDeadlineDigest(alerts: DeadlineAlert[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || alerts.length === 0) return;
  const resend = new Resend(key);
  const rows = alerts
    .map(
      (a) =>
        `<tr><td style="padding:4px 16px 4px 0">${a.deal_address}</td><td style="padding:4px 16px 4px 0">${a.label}</td><td style="padding:4px 16px 4px 0">${a.target_date}</td><td style="padding:4px 0"><b style="color:${a.days <= 2 ? "#d4183d" : "#d4af37"}">${a.days}d</b></td></tr>`,
    )
    .join("");
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#0a0a0a;line-height:1.6">
      <h2 style="color:#0f1c3f;margin:0 0 12px">Upcoming deal deadlines</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr style="color:#6e6e73;text-align:left"><th style="padding-right:16px">Deal</th><th style="padding-right:16px">Milestone</th><th style="padding-right:16px">Date</th><th>Due in</th></tr>
        ${rows}
      </table>
    </div>`;

  await resend.emails.send({
    from: "Portfolio AI <noreply@mail.investportfolio.ai>",
    to: TO,
    subject: `Deal deadlines — ${alerts.length} milestone${alerts.length === 1 ? "" : "s"} approaching`,
    html,
  });
}
