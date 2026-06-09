import "server-only";

/**
 * True only when the request carries the correct cron bearer token. Denies by
 * default: if CRON_SECRET isn't configured, no request is authorized. Vercel
 * automatically sends `Authorization: Bearer <CRON_SECRET>` to cron paths when
 * the env var is set.
 */
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.replace(/\s/g, "");
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
