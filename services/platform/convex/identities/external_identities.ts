import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

const EXTERNAL_OWNER_SEPARATOR = ':';

/**
 * Build a namespaced, org-scoped thread-owner id for an external author, e.g.
 * `buildExternalOwnerId('slack', 'U07ABC123', 'org_42') === 'slack:org_42:U07ABC123'`.
 *
 * The organization is part of the key on purpose: the same Slack user id can
 * appear in two workspaces connected to two different orgs (Enterprise Grid /
 * shared members). Scoping the owner id per org keeps each org's identity row
 * and display name isolated, so one org's name can never bleed into another's
 * prompts or member lists.
 */
export function buildExternalOwnerId(
  source: string,
  externalUserId: string,
  organizationId: string,
): string {
  return [source, organizationId, externalUserId].join(
    EXTERNAL_OWNER_SEPARATOR,
  );
}

/**
 * True when a thread-owner `userId` is NOT a Better Auth user id and therefore
 * must not be passed to the Better Auth adapter (its `_id` lookups route
 * through `ctx.db.get`, which throws on non-Convex-id strings). Covers the
 * `'system'` sentinel and namespaced external owners like `slack:org_42:U123`.
 * Real Better Auth ids never contain the separator.
 */
export function isExternalOwnerId(userId: string): boolean {
  return userId === 'system' || userId.includes(EXTERNAL_OWNER_SEPARATOR);
}

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
