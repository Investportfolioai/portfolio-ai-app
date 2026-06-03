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
  { label: "Pipeline", href: "/dashboard/pipeline" },
  { label: "Deals", href: "/dashboard/deals" },
  { label: "Underwriting", href: "/dashboard/underwriting" },
  { label: "Key Principals", href: "/dashboard/kps" },
  { label: "Lenders", href: "/dashboard/lenders" },
  { label: "Documents", href: "/dashboard/documents" },
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
    <aside className="flex w-60 shrink-0 flex-col bg-navy-950 text-slate-300">
      <div className="flex items-center gap-2.5 px-6 py-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gold font-bold text-navy-950">
          P
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide text-white">
            Portfolio AI
          </div>
          <div className="text-[11px] text-slate-500">Capital</div>
        </div>
      </div>

      <nav className="mt-2 flex-1 px-3">
        {NAV.map((item) => {
          const active = item.href ? pathname.startsWith(item.href) : false;
          const base =
            "block rounded-md px-3 py-2 text-sm font-medium transition-colors";

          if (!item.href) {
            return (
              <span
                key={item.label}
                className={`${base} cursor-default text-slate-600`}
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
                  ? `${base} bg-navy-800 text-white shadow-[inset_3px_0_0_0_var(--color-gold)]`
                  : `${base} text-slate-400 hover:bg-navy-800/60 hover:text-white`
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/5 p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-gold-soft">
            {initials}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-white">
              {user.full_name ?? user.email ?? "Signed in"}
            </div>
            {user.role && (
              <div className="text-[11px] text-slate-500">
                {ROLE_LABELS[user.role]}
              </div>
            )}
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="mt-1 w-full rounded-md px-2 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-navy-800 hover:text-white"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
