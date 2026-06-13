"use client";

import { useRef, useState, useEffect } from "react";
import { logout } from "@/app/login/actions";
import type { SidebarUser } from "./sidebar";

export function UserMenu({ user }: { user: SidebarUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initials = (user.full_name ?? user.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="User menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-opacity hover:opacity-80"
        style={{
          background: "rgba(201,168,76,0.15)",
          color: "#C9A84C",
          border: "1px solid rgba(201,168,76,0.35)",
        }}
      >
        {initials}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-xl shadow-2xl"
          style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div
            className="px-4 py-3"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            {user.full_name && (
              <div className="truncate text-sm font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>
                {user.full_name}
              </div>
            )}
            <div className="truncate text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
              {user.email}
            </div>
          </div>
          <div className="p-2">
            <form action={logout}>
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors"
                style={{ color: "rgba(255,255,255,0.5)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.9)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "";
                  e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
