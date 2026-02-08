import type { QueryCtx, MutationCtx, ActionCtx } from '../../../_generated/server';
import type { AuthenticatedUser } from '../types';

/**
 * Lightweight auth check using JWT identity (0 database queries).
 * Use this in queries instead of authComponent.getAuthUser which performs
 * 2 cross-component DB queries (session + user lookup).
 *
 * The JWT is already cryptographically validated by Convex before the
 * function runs, so this is safe for read-only query authorization.
 */
export async function getAuthUserIdentity(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<AuthenticatedUser | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !identity.subject) {
    return null;
  }
  return {
    userId: identity.subject,
    email: identity.email ?? undefined,
    name: identity.name ?? undefined,
  };
}
