import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { canonicalResourcePath } from './helpers';

// Find a lock for a (org, path). Returns the live lock, or null. Surfaces
// `expiredId` for callers that want to opportunistically evict the stale
// row via deleteLock — keeps eviction lazy per feedback_lazy_cleanup_over_cron.
export const findLockForPath = internalQuery({
  args: {
    organizationId: v.string(),
    resourcePath: v.string(),
  },
  async handler(ctx, args) {
    const path = canonicalResourcePath(args.resourcePath);
    const row = await ctx.db
      .query('webdavLocks')
      .withIndex('by_organization_resource', (q) =>
        q.eq('organizationId', args.organizationId).eq('resourcePath', path),
      )
      .first();
    if (!row) return { lock: null, expiredId: null };
    if (row.expiresAt <= Date.now()) {
      return { lock: null, expiredId: row._id };
    }
    return {
      lock: {
        _id: row._id,
        lockToken: row.lockToken,
        ownerUserId: row.ownerUserId,
        ownerXml: row.ownerXml,
        depth: row.depth,
        scope: row.scope,
        expiresAt: row.expiresAt,
      },
      expiredId: null,
    };
  },
});

// Lookup by wire token. Used by UNLOCK to verify the supplied
// Lock-Token header before deleting.
export const findLockByToken = internalQuery({
  args: {
    token: v.string(),
  },
  async handler(ctx, args) {
    const row = await ctx.db
      .query('webdavLocks')
      .withIndex('by_token', (q) => q.eq('lockToken', args.token))
      .first();
    if (!row) return null;
    if (row.expiresAt <= Date.now()) return null;
    return {
      _id: row._id,
      organizationId: row.organizationId,
      resourcePath: row.resourcePath,
      ownerUserId: row.ownerUserId,
      expiresAt: row.expiresAt,
    };
  },
});
