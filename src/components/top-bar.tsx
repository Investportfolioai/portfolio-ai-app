import type { SidebarUser } from "./sidebar";
import { UserMenu } from "./user-menu";

export function TopBar({ user }: { user: SidebarUser }) {
  return (
    <header
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between px-4 md:justify-end md:px-6"
      style={{ background: "#0d0d16", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Logo — only visible on mobile since desktop has the sidebar */}
      <div className="md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Portfolio AI" className="max-h-7 max-w-full" />
      </div>

      <UserMenu user={user} />
    </header>
  );
}
