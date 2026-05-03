import type { MutationCtx } from '../_generated/server';
import { rateLimiter } from '../lib/rate_limiter';
import { SOFT_DELETE_TTL_MS } from './constants';

/**
 * Opportunistic per-(user, org) GC for personalization memories. Replaces
 * a centralized cron entry: every memory-touching mutation calls this at
 * the top, and the rate-limiter gate keeps the work to at most once per
 * hour per (userId, organizationId) tuple.
 *
 * Two stale categories are physically deleted:
 *  1. `pending` rows whose 24h `pendingExpiresAt` window passed without
 *     user confirmation — never approved, no soft-delete trail.
 *  2. `deletedAt` rows older than 30 days — already invisible to the user,
 *     this just reclaims storage.
 *
 * Active GDPR Art 17 erasure (account deletion / member removal / org
 * deletion) does NOT depend on this — those go through the explicit
 * cascade hooks in `lib/cascades/personalization_cascade.ts`.
 */
export async function maybeRunCleanup(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
): Promise<void> {
  const result = await rateLimiter.limit(ctx, 'cleanup:personalization', {
    key: `user:${userId}:org:${organizationId}`,
    throws: false,
  });
  if (!result.ok) return;

  const now = Date.now();
  const memories = await ctx.db
    .query('userMemories')
    .withIndex('by_user_org_status_deleted_created', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .collect();
  for (const m of memories) {
    const isStalePending =
      m.status === 'pending' &&
      typeof m.pendingExpiresAt === 'number' &&
      m.pendingExpiresAt < now;
    const isStaleDeleted =
      typeof m.deletedAt === 'number' && m.deletedAt < now - SOFT_DELETE_TTL_MS;
    if (isStalePending || isStaleDeleted) await ctx.db.delete(m._id);
  }
}
