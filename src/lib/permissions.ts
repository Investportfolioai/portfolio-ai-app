import "server-only";

/** True for users who can write deals, holdings, and other owner-managed data. */
export function canManage(role: string | null): boolean {
  return role === "owner" || role === "partner" || role === "manager";
}
