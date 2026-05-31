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

// All UNEXPIRED locks strictly under a collection path (`path/…`). Used
// to enforce RFC 4918 §9.6.1/§9.9: DELETE/MOVE of a collection must fail
// 423 if any internal member is locked without the token submitted. The
// per-resource findLockForPath only covers the target + ancestors, not
// descendants — this prefix scan fills that gap. '\uffff' bounds the
// prefix range (resource paths are percent-encoded ASCII).
export const findLocksUnderPath = internalQuery({
  args: {
    organizationId: v.string(),
    resourcePath: v.string(),
  },
  async handler(ctx, args) {
    const path = canonicalResourcePath(args.resourcePath);
    const now = Date.now();
    const rows = await ctx.db
      .query('webdavLocks')
      .withIndex('by_organization_resource', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('resourcePath', path + '/')
          .lt('resourcePath', path + '/\uffff'),
      )
      .collect();
    return rows
      .filter((r) => r.expiresAt > now)
      .map((r) => ({ resourcePath: r.resourcePath, lockToken: r.lockToken }));
  },
});

// Lookup by wire token. Used by UNLOCK to verify the supplied
// Lock-Token header before deleting, AND by LOCK refresh to echo the
// stored ownerXml / scope / depth back to the client (RFC §9.10.5).
// Refresh needs the full row, so we return everything callers might
// want — UNLOCK ignores the extra fields.
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
      lockToken: row.lockToken,
      ownerUserId: row.ownerUserId,
      ownerXml: row.ownerXml,
      depth: row.depth,
      scope: row.scope,
      expiresAt: row.expiresAt,
    };
  },
});
