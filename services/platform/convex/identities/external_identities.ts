import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

const EXTERNAL_OWNER_SEPARATOR = ':';

/**
 * Build a namespaced thread-owner id for an external author, e.g.
 * `buildExternalOwnerId('slack', 'U07ABC123') === 'slack:U07ABC123'`.
 */
export function buildExternalOwnerId(
  source: string,
  externalUserId: string,
): string {
  return `${source}${EXTERNAL_OWNER_SEPARATOR}${externalUserId}`;
}

/**
 * True when a thread-owner `userId` is NOT a Better Auth user id and therefore
 * must not be passed to the Better Auth adapter (its `_id` lookups route
 * through `ctx.db.get`, which throws on non-Convex-id strings). Covers the
 * `'system'` sentinel and namespaced external owners like `slack:U123`. Real
 * Better Auth ids never contain the separator.
 */
export function isExternalOwnerId(userId: string): boolean {
  return userId === 'system' || userId.includes(EXTERNAL_OWNER_SEPARATOR);
}

/**
 * Upsert an external author identity, keyed by the derived owner id. Refreshes
 * the display name / handle / avatar when provided; callers gate how often they
 * refetch (see the inbound Slack processor's freshness check).
 */
export const upsertExternalIdentity = internalMutation({
  args: {
    source: v.literal('slack'),
    organizationId: v.string(),
    externalUserId: v.string(),
    displayName: v.optional(v.string()),
    handle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const ownerId = buildExternalOwnerId(args.source, args.externalUserId);
    const now = Date.now();

    const existing = await ctx.db
      .query('externalIdentities')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName ?? existing.displayName,
        handle: args.handle ?? existing.handle,
        avatarUrl: args.avatarUrl ?? existing.avatarUrl,
        updatedAt: now,
      });
      return ownerId;
    }

    await ctx.db.insert('externalIdentities', {
      ownerId,
      source: args.source,
      organizationId: args.organizationId,
      externalUserId: args.externalUserId,
      displayName: args.displayName,
      handle: args.handle,
      avatarUrl: args.avatarUrl,
      updatedAt: now,
    });
    return ownerId;
  },
});

export const getByOwnerId = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    return await ctx.db
      .query('externalIdentities')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
      .first();
  },
});
