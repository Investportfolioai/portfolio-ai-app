import "server-only";
import { Resend } from "resend";
import { RECOMMENDATION_LABELS, type Recommendation } from "@/lib/types";

/**
 * Transactional email via Resend. Sends from the investportfolio.ai domain
 * (verify it in Resend after deploy) to the owner inbox.
 */
const FROM = "Portfolio AI <deals@mail.investportfolio.ai>";
const TO = "john@investportfolio.ai";

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
    subject: `New deal submission — ${data.propertyAddress}`,
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
