"use client";

import { useState } from "react";
import Link from "next/link";

export interface TcDeal {
  deal_id: string;
  property_address: string;
  stage: string;
  status: string;
  asset_type: string | null;
}

interface Props {
  profile: { name: string | null; email: string | null };
  tabs: string[];
  deals: TcDeal[];
}

const STAGE_LABEL: Record<string, string> = {
  prospecting: "Prospecting",
  structuring: "Structuring",
  loi: "LOI",
  contract: "Contract",
  rehab: "Rehab",
  stabilizing: "Stabilizing",
  exited: "Exited",
};

export function TcDashboardClient({ profile, tabs, deals }: Props) {
  const [activeTab, setActiveTab] = useState(tabs[0] ?? "");

  const initials = (profile.name ?? profile.email ?? "TC")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div style={{ background: "#0A0B14", minHeight: "100vh", fontFamily: "var(--font-body, DM Sans, sans-serif)" }}>
      {/* Top bar */}
      <div
        style={{
          background: "#0d0d16",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          height: "56px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="Portfolio AI" style={{ height: "28px", width: "auto" }} />
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
            {profile.email}
          </span>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "rgba(201,168,76,0.15)",
              border: "1px solid rgba(201,168,76,0.35)",
              color: "#C9A84C",
              fontSize: "11px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {initials}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "32px 24px" }}>
        {/* Header */}
        <div style={{ marginBottom: "24px" }}>
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 300,
              color: "#fff",
              fontFamily: "var(--font-display, 'Cormorant Garamond', serif)",
              letterSpacing: "-0.02em",
              marginBottom: "4px",
            }}
          >
            {profile.name ?? "TC Dashboard"}
          </h1>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)" }}>
            Transaction Coordinator · {deals.length} deal{deals.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Tab switcher — only show granted tabs */}
        {tabs.length > 1 && (
          <div
            style={{
              display: "inline-flex",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "#1a1d27",
              padding: "4px",
              marginBottom: "24px",
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-pressed={activeTab === tab}
                style={
                  activeTab === tab
                    ? {
                        background: "linear-gradient(135deg, #C9A84C, #EBB66A)",
                        color: "#0A0B14",
                        borderRadius: "8px",
                        padding: "6px 16px",
                        fontSize: "13px",
                        fontWeight: 600,
                        border: "none",
                        cursor: "pointer",
                      }
                    : {
                        color: "rgba(255,255,255,0.45)",
                        borderRadius: "8px",
                        padding: "6px 16px",
                        fontSize: "13px",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                      }
                }
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* No access */}
        {tabs.length === 0 && (
          <div
            style={{
              background: "#1a1d27",
              borderRadius: "16px",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
              No tab access has been granted yet. Contact your account admin.
            </p>
          </div>
        )}

        {/* Lending tab */}
        {activeTab === "lending" && (
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "rgba(255,255,255,0.45)",
                marginBottom: "12px",
              }}
            >
              Assigned Deals
            </div>
            {deals.length === 0 ? (
              <div
                style={{
                  background: "#1a1d27",
                  borderRadius: "16px",
                  border: "1px solid rgba(255,255,255,0.06)",
                  padding: "48px 24px",
                  textAlign: "center",
                }}
              >
                <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
                  No deals assigned yet.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {deals.map((deal) => (
                  <TcDealRow key={deal.deal_id} deal={deal} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Documents tab */}
        {activeTab === "documents" && (
          <div
            style={{
              background: "#1a1d27",
              borderRadius: "16px",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
              Documents tab — coming soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TcDealRow({ deal }: { deal: TcDeal }) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={`/tc/lending/${deal.deal_id}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#1a1d27",
        borderRadius: "12px",
        padding: "16px 20px",
        border: `1px solid ${hovered ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.06)"}`,
        boxShadow: hovered ? "0 0 0 1px rgba(201,168,76,0.4), 0 8px 24px rgba(201,168,76,0.15)" : "none",
        transition: "border-color 200ms ease, box-shadow 200ms ease",
        textDecoration: "none",
        cursor: "pointer",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "2px" }}>
          {deal.property_address}
        </div>
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
          {deal.asset_type ?? "—"} · {STAGE_LABEL[deal.stage] ?? deal.stage}
        </div>
      </div>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={hovered ? "#C9A84C" : "rgba(255,255,255,0.2)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 200ms ease", flexShrink: 0 }}>
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}
