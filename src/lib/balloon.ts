/**
 * Balloon-payment timer logic. Pure + isomorphic (used in client badges and
 * server alerts). Color/label bands are driven by years remaining.
 */

export type BalloonUrgency = "none" | "low" | "medium" | "high" | "critical";

export interface BalloonStatus {
  label: string;
  color: string;
  daysRemaining: number | null;
  yearsRemaining: number | null;
  urgency: BalloonUrgency;
}

const MS_PER_DAY = 86_400_000;

export function getBalloonStatus(balloon_date: string | null): BalloonStatus {
  if (!balloon_date) {
    return {
      label: "No Balloon Set",
      color: "#6b7280", // gray
      daysRemaining: null,
      yearsRemaining: null,
      urgency: "none",
    };
  }

  const target = new Date(balloon_date + (balloon_date.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(target.getTime())) {
    return { label: "No Balloon Set", color: "#6b7280", daysRemaining: null, yearsRemaining: null, urgency: "none" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysRemaining = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  const yearsRemaining = daysRemaining / 365.25;

  if (yearsRemaining >= 10) {
    return { label: "Long Term", color: "#c9a84c", daysRemaining, yearsRemaining, urgency: "none" };
  }
  if (yearsRemaining >= 5) {
    return { label: "Stable", color: "#22c55e", daysRemaining, yearsRemaining, urgency: "low" };
  }
  if (yearsRemaining >= 3) {
    return { label: "Watch", color: "#eab308", daysRemaining, yearsRemaining, urgency: "medium" };
  }
  if (yearsRemaining >= 1) {
    return { label: "Action Needed", color: "#f97316", daysRemaining, yearsRemaining, urgency: "high" };
  }
  return { label: "URGENT", color: "#ef4444", daysRemaining, yearsRemaining, urgency: "critical" };
}

/** e.g. "3y 4mo remaining", "8mo remaining", or "past due". */
export function formatBalloonDisplay(balloon_date: string | null): string {
  const { daysRemaining } = getBalloonStatus(balloon_date);
  if (daysRemaining == null) return "No balloon date";
  if (daysRemaining < 0) return "Past due";

  const years = Math.floor(daysRemaining / 365);
  const months = Math.floor((daysRemaining % 365) / 30);
  if (years > 0) return `${years}y ${months}mo remaining`;
  if (months > 0) return `${months}mo remaining`;
  return `${daysRemaining}d remaining`;
}
