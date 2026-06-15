"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
type NavItem = { label: string; href?: string; icon?: LucideIcon };

export interface SidebarUser {
  email: string | null;
  full_name: string | null;
  role: import("@/lib/types").UserRole | null;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Sandbox", href: "/sandbox", icon: LayoutGrid },
  { label: "Pipeline", href: "/dashboard/pipeline" },
  { label: "Portfolio", href: "/dashboard/portfolio" },
  { label: "Deals", href: "/dashboard/deals" },
  { label: "Underwriting", href: "/dashboard/underwriting" },
  { label: "Key Principals", href: "/dashboard/kps" },
  { label: "Lenders", href: "/dashboard/lenders" },
  { label: "Documents", href: "/dashboard/documents" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    function onDealClosed() {
      setCollapsed(true);
      setTimeout(() => setCollapsed(false), 4000);
    }
    window.addEventListener("dealClosed", onDealClosed);
    return () => window.removeEventListener("dealClosed", onDealClosed);
  }, []);

  return (
    <aside className={`flex w-[220px] shrink-0 flex-col bg-sidebar text-sidebar-foreground${collapsed ? " sidebar-collapsed" : ""}`}>
      {/* Logo area — gold orb glow behind */}
      <div className="relative px-6 py-6">
        <div style={{
          position: "absolute",
          top: "-24px", left: "-24px",
          width: "180px", height: "120px",
          background: "radial-gradient(ellipse at 40% 50%, rgba(201,168,76,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="Portfolio AI" className="relative max-h-9 max-w-full" />
      </div>

      <nav className="mt-2 flex-1 px-3">
        {NAV.map((item) => {
          const active = item.href
            ? item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href)
            : false;
          const base =
            "flex items-center gap-2 rounded-md py-2 pl-3 pr-3 text-sm font-medium transition-all duration-150";
          const Icon = item.icon;

          if (!item.href) {
            return (
              <span
                key={item.label}
                className={`${base} cursor-default text-sidebar-foreground/30`}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" />}
                {item.label}
              </span>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? `${base} text-[#C9A84C]`
                  : `${base} text-sidebar-foreground/55 hover:text-[#C9A84C] hover:[text-shadow:0_0_8px_rgba(201,168,76,0.35)]`
              }
              style={active ? { background: "rgba(201,168,76,0.06)", boxShadow: "inset 2px 0 0 #C9A84C" } : undefined}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {item.label}
            </Link>
          );
        })}
      </nav>

    </aside>
  );
}
