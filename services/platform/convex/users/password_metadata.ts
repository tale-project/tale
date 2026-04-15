import type { MutationCtx } from '../_generated/server';

/**
 * Record that the given user's credential password was just set/changed.
 * Upserts the `userPasswordMetadata` row used by the rotation policy to
 * compute expiry. Kept separate from Better Auth's `account.updatedAt`
 * because that timestamp is also patched by non-password events (e.g.
 * OAuth token refresh) and so is not a trustworthy anchor.
 */
export async function recordPasswordChange(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const existing = await ctx.db
    .query('userPasswordMetadata')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();

  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { passwordChangedAt: now });
  } else {
    await ctx.db.insert('userPasswordMetadata', {
      userId,
      passwordChangedAt: now,
    });
  }
}
