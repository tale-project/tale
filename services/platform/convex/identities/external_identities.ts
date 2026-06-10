import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';
import { buildExternalOwnerId } from './external_identities_helpers';

// The pure owner-id helpers now live in `external_identities_helpers.ts` (a
// function-free module) so client code can import them WITHOUT dragging these
// `internalMutation`/`internalQuery` definitions into the browser bundle (a
// convex function builder runs `assertNotBrowser()` at module-init). They are
// re-exported here so existing server importers and the test suite keep
// resolving them from this module unchanged.
export {
  buildExternalOwnerId,
  isExternalOwnerId,
} from './external_identities_helpers';

/**
 * Upsert an external author identity, keyed by the org-scoped owner id.
 * Refreshes the display name / handle / avatar only when the caller actually
 * fetched new data — a failed fetch (all fields undefined) leaves the row
 * untouched, so `updatedAt` stays stale and the next message retries instead
 * of being suppressed for the full refresh window.
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
    const ownerId = buildExternalOwnerId(
      args.source,
      args.externalUserId,
      args.organizationId,
    );
    const now = Date.now();

    const existing = await ctx.db
      .query('externalIdentities')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
      .first();

    if (existing) {
      const gotNewData =
        args.displayName !== undefined ||
        args.handle !== undefined ||
        args.avatarUrl !== undefined;
      // Nothing fetched this round: do NOT touch updatedAt, or a failed refresh
      // would reset the freshness window and stop us retrying.
      if (!gotNewData) return ownerId;

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

/**
 * Resolve an external identity by its org-scoped owner id. Returns only the
 * fields the owner→name resolution sites need (display name + freshness), never
 * the whole row, so callers stay decoupled from the table shape.
 */
export const getByOwnerId = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      displayName: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { ownerId }) => {
    const row = await ctx.db
      .query('externalIdentities')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
      .first();
    if (!row) return null;
    return { displayName: row.displayName, updatedAt: row.updatedAt };
  },
});
