/**
 * Revocation decision for a single session row. Already-expired sessions are
 * dead — Better Auth rejects them on next use — so revoking them would only
 * burn the per-run write budget.
 */
export function shouldRevokeIdleSession(args: {
  updatedAt: number;
  expiresAt: number;
  windowMs: number;
  now: number;
}): boolean {
  if (args.expiresAt <= args.now) return false;
  return args.now - args.updatedAt > args.windowMs;
}
