import "server-only";
import { Resend } from "resend";
import type { BalloonStatus } from "@/lib/balloon";

const FROM = "Portfolio AI <deals@mail.investportfolio.ai>";
const TO = ["john@investportfolio.ai", "loa@investportfolio.ai"];

export interface BalloonHolding {
  address: string;
  balloon_date: string | null;
  extension_clause: string | null;
  important_notes: string | null;
  monthly_payment?: number | null;
}

/**
 * Alert the principals when a holding's balloon enters a high/critical window.
 * From deals@mail.investportfolio.ai → john + loa. Best-effort (never throws).
 */
export async function sendBalloonAlert(
  holding: BalloonHolding,
  status: BalloonStatus,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY missing — skipping balloon alert.");
    return;
  }

  const days = status.daysRemaining ?? 0;
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#0a0a0a;line-height:1.6;max-width:560px">
      <h2 style="color:#0a1628;margin:0 0 4px">⚠️ Balloon Alert</h2>
      <p style="margin:0 0 16px;color:#6e6e73">${holding.address}</p>
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Status</td><td><b style="color:${status.color}">${status.label}</b></td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Balloon date</td><td>${holding.balloon_date ?? "—"}</td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Days remaining</td><td><b>${days}</b></td></tr>
        ${holding.monthly_payment != null ? `<tr><td style="padding:3px 16px 3px 0;color:#6e6e73">Monthly payment</td><td>$${Number(holding.monthly_payment).toLocaleString("en-US")}</td></tr>` : ""}
      </table>
      ${holding.extension_clause ? `<p style="margin:0 0 12px;font-size:14px"><b>Extension clause:</b> ${holding.extension_clause}</p>` : ""}
      ${holding.important_notes ? `<div style="margin:0 0 12px;border-left:3px solid #c9a84c;padding:4px 0 4px 14px;font-size:14px;white-space:pre-wrap">${holding.important_notes}</div>` : ""}
      <p style="margin:16px 0 0;color:#6e6e73;font-size:13px">Review this balloon in the Portfolio → Balloon Tracker.</p>
    </div>`;

  const resend = new Resend(key);
  await resend.emails.send({
    from: FROM,
    to: TO,
    subject: `⚠️ Balloon Alert: ${holding.address} — ${status.label}`,
    html,
  });
}
