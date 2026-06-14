"use client";

export type BadgeStatus =
  | "active"
  | "building"
  | "idle"
  | "pending"
  | "escrow"
  | "closed"
  | "dead"
  | "passed";

const STATUS_MAP: Record<BadgeStatus, { bg: string; color: string }> = {
  active:   { bg: "rgba(34,197,94,0.12)",    color: "#22c55e" },
  closed:   { bg: "rgba(34,197,94,0.12)",    color: "#22c55e" },
  building: { bg: "rgba(245,158,11,0.12)",   color: "#f59e0b" },
  pending:  { bg: "rgba(245,158,11,0.12)",   color: "#f59e0b" },
  escrow:   { bg: "rgba(59,130,246,0.12)",   color: "#3b82f6" },
  dead:     { bg: "rgba(255,255,255,0.06)",  color: "#52525b" },
  passed:   { bg: "rgba(255,255,255,0.06)",  color: "#52525b" },
  idle:     { bg: "rgba(255,255,255,0.06)",  color: "#52525b" },
};

export function StatusBadge({
  status,
  label,
}: {
  status: BadgeStatus;
  label?: string;
}) {
  const s = STATUS_MAP[status];
  const displayLabel = label ?? status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        borderRadius: "999px",
        padding: "2px 8px",
        background: s.bg,
        color: s.color,
        fontSize: "0.6rem",
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: "5px",
          height: "5px",
          borderRadius: "50%",
          background: s.color,
          flexShrink: 0,
        }}
      />
      {displayLabel}
    </span>
  );
}
