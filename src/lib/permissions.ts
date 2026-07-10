import "server-only";

/** True for users who can write deals, holdings, and other owner-managed data. */
export function canManage(role: string | null): boolean {
  return role === "owner" || role === "partner" || role === "manager";
}

/**
 * True for users who can access the Portfolio tab (holdings). Excludes
 * "manager" — managers get full deal write access but not Portfolio.
 */
export function canManagePortfolio(role: string | null): boolean {
  return role === "owner" || role === "partner";
}
