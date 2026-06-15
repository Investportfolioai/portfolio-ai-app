import Link from "next/link";
import { Fragment } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

type Item = { n: number; label: string; href: string; urgent?: boolean };

export async function PipelineStatus() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deals")
    .select("status, escrow_date, acquisition_grade")
    .in("status", ["active", "pending"]);

  if (error || !data || data.length === 0) return null;

  const rows = data as { status: string; escrow_date: string | null; acquisition_grade: number | null }[];

  const totalActive = rows.length;
  const inEscrow = rows.filter((r) => r.status === "active" && r.escrow_date != null).length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const ungraded = rows.filter((r) => r.acquisition_grade == null).length;

  const items: Item[] = [
    { n: totalActive, label: "active", href: "/dashboard/pipeline" },
    ...(inEscrow > 0 ? [{ n: inEscrow, label: "in escrow", href: "/dashboard/pipeline?status=escrow" }] : []),
    ...(pending > 0 ? [{ n: pending, label: "pending review", href: "/dashboard/pipeline?status=pending" }] : []),
    ...(ungraded > 0 ? [{ n: ungraded, label: "needs underwriting", href: "/dashboard/underwriting", urgent: true }] : []),
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      {items.map((item, i) => (
        <Fragment key={item.href}>
          {i > 0 && (
            <span style={{
              color: "rgba(255,255,255,0.12)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              userSelect: "none",
            }}>
              ·
            </span>
          )}
          <Link
            href={item.href}
            className="hover:opacity-70 transition-opacity duration-150"
            style={{ display: "inline-flex", alignItems: "baseline", gap: "5px", textDecoration: "none" }}
          >
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: "1.125rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: item.urgent ? "#f59e0b" : "#C9A84C",
              fontVariantNumeric: "tabular-nums",
            }}>
              {item.n}
            </span>
            <span style={{
              fontFamily: "var(--font-body), sans-serif",
              fontSize: "0.75rem",
              fontWeight: 400,
              color: item.urgent ? "rgba(245,158,11,0.55)" : "rgba(255,255,255,0.32)",
              letterSpacing: "0.01em",
            }}>
              {item.label}
            </span>
          </Link>
        </Fragment>
      ))}
    </div>
  );
}
