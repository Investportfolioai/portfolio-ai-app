import type { SidebarUser } from "./sidebar";
import { UserMenu } from "./user-menu";
import { ReviewQueueBell } from "./review-queue-bell";

const TRUSTED_ROLES = new Set(["owner", "partner", "manager"]);

export function TopBar({ user }: { user: SidebarUser }) {
  return (
    <header
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between px-4 md:justify-end md:px-6"
      style={{ background: "#0d0d16", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Logo — only visible on mobile since desktop has the sidebar */}
      <div className="md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="Portfolio AI" className="max-h-7 max-w-full" />
      </div>

      <div className="flex items-center gap-3">
        {user.role && TRUSTED_ROLES.has(user.role) && <ReviewQueueBell />}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
