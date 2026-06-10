"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import { ROLE_LABELS, type UserRole } from "@/lib/types";

type NavItem = { label: string; href?: string };

export interface SidebarUser {
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Pipeline", href: "/dashboard/pipeline" },
  { label: "Portfolio", href: "/dashboard/portfolio" },
  { label: "Deals", href: "/dashboard/deals" },
  { label: "Underwriting", href: "/dashboard/underwriting" },
  { label: "Key Principals", href: "/dashboard/kps" },
  { label: "Lenders", href: "/dashboard/lenders" },
  { label: "Documents", href: "/dashboard/documents" },
  { label: "Sandbox", href: "/sandbox" },
];

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const initials = (user.full_name ?? user.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-6 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Portfolio AI" className="max-h-9 max-w-full" />
      </div>

      <nav className="mt-2 flex-1 px-3">
        {NAV.map((item) => {
          const active = item.href
            ? item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href)
            : false;
          const base =
            "block rounded-md py-2 pl-3 pr-3 text-sm font-medium transition-all duration-150";

          if (!item.href) {
            return (
              <span
                key={item.label}
                className={`${base} cursor-default text-sidebar-foreground/30`}
              >
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
                  ? `${base} border-l-2 border-accent pl-[10px] text-accent`
                  : `${base} text-sidebar-foreground/60 hover:translate-x-0.5 hover:text-accent hover:[text-shadow:0_0_8px_rgba(212,175,55,0.45)]`
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-accent">
            {initials}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-sidebar-foreground">
              {user.full_name ?? "Signed in"}
            </div>
            <div className="truncate text-[11px] text-accent">
              {user.email ?? (user.role ? ROLE_LABELS[user.role] : "")}
            </div>
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="mt-1 w-full rounded-md px-2 py-2 text-left text-sm text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
