import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { canonicalResourcePath } from './helpers';

const MAX_LOCK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour cap

export const createLock = internalMutation({
  args: {
    organizationId: v.string(),
    resourcePath: v.string(),
    lockToken: v.string(),
    ownerXml: v.string(),
    depth: v.union(v.literal('0'), v.literal('infinity')),
    scope: v.union(v.literal('exclusive'), v.literal('shared')),
    ownerUserId: v.string(),
    appPasswordId: v.id('webdavAppPasswords'),
    timeoutMs: v.number(),
  },
  async handler(ctx, args) {
    const path = canonicalResourcePath(args.resourcePath);

    // Re-check at write time. Two clients racing for an exclusive lock
    // could both pass the lookup; whichever inserts first wins, the
    // other gets 423.
    const existing = await ctx.db
      .query('webdavLocks')
      .withIndex('by_organization_resource', (q) =>
        q.eq('organizationId', args.organizationId).eq('resourcePath', path),
      )
      .first();
    if (existing && existing.expiresAt > Date.now()) {
      throw new ConvexError({ code: 'LOCKED' });
    }
    if (existing) await ctx.db.delete(existing._id);

    const timeoutMs = Math.min(args.timeoutMs, MAX_LOCK_TIMEOUT_MS);
    const id = await ctx.db.insert('webdavLocks', {
      organizationId: args.organizationId,
      resourcePath: path,
      lockToken: args.lockToken,
      ownerXml: args.ownerXml,
      depth: args.depth,
      scope: args.scope,
      ownerUserId: args.ownerUserId,
      appPasswordId: args.appPasswordId,
      expiresAt: Date.now() + timeoutMs,
    });
    return { _id: id, expiresAt: Date.now() + timeoutMs };
  },
});

// RFC 4918 §9.10.2 — LOCK with If: header + empty body refreshes the
// timeout. Caller verifies the If token matches.
export const refreshLock = internalMutation({
  args: {
    lockToken: v.string(),
    timeoutMs: v.number(),
  },
  async handler(ctx, args) {
    const row = await ctx.db
      .query('webdavLocks')
      .withIndex('by_token', (q) => q.eq('lockToken', args.lockToken))
      .first();
    if (!row) throw new ConvexError({ code: 'NOT_FOUND' });
    if (row.expiresAt <= Date.now()) {
      // Stale — clients are supposed to re-LOCK rather than refresh.
      await ctx.db.delete(row._id);
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    const timeoutMs = Math.min(args.timeoutMs, MAX_LOCK_TIMEOUT_MS);
    const newExpiresAt = Date.now() + timeoutMs;
    await ctx.db.patch(row._id, { expiresAt: newExpiresAt });
    return { expiresAt: newExpiresAt };
  },
});

export const releaseLock = internalMutation({
  args: {
    lockToken: v.string(),
    ownerUserId: v.string(),
  },
  async handler(ctx, args) {
    const row = await ctx.db
      .query('webdavLocks')
      .withIndex('by_token', (q) => q.eq('lockToken', args.lockToken))
      .first();
    if (!row) return; // Idempotent — already gone.
    if (row.ownerUserId !== args.ownerUserId) {
      // RFC 4918 §9.11.1: only the lock owner can UNLOCK.
      throw new ConvexError({ code: 'FORBIDDEN' });
    }
    await ctx.db.delete(row._id);
  },
});

// Lazy GC entry. Called by findLockForPath callers when they see
// expiredId set. Idempotent — safe to call on already-deleted rows.
export const deleteLockIfStale = internalMutation({
  args: {
    id: v.id('webdavLocks'),
  },
  async handler(ctx, args) {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    if (row.expiresAt > Date.now()) return; // Raced — a refresh extended it.
    await ctx.db.delete(args.id);
  },
});
