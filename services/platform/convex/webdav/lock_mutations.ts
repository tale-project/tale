import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { canonicalResourcePath } from './helpers';

const MAX_LOCK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour cap

// Hard cap on the number of live locks a single app-password may hold.
// Prevents a misbehaving / malicious client from filling the table with
// long-lived locks. 200 is generous — Office and rclone hold at most
// a handful at once; only sync engines doing per-file LOCK across a
// large tree would approach this, and they should re-architect to use
// fewer collection-level locks instead.
const MAX_LOCKS_PER_APP_PASSWORD = 200;

// Proper ancestors of a canonical lock path, most-specific first. e.g.
// '/documents/foo/bar.txt' → ['/documents/foo', '/documents']. The
// namespace root itself ('/documents') is included; the synthetic '/'
// root is not (no lock is ever created there).
function ancestorPaths(path: string): string[] {
  const parts = path.split('/'); // ['', 'documents', 'foo', 'bar.txt']
  const out: string[] = [];
  for (let i = parts.length - 1; i > 1; i--) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
}

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

    // Per-app-password rate limit. Counts live AND expired rows — a
    // client that creates 200 locks and never UNLOCKs is the exact
    // case we want to throttle, and stale rows get evicted lazily on
    // read elsewhere. RATE_LIMITED → handler returns 503.
    const heldByPassword = await ctx.db
      .query('webdavLocks')
      .withIndex('by_appPasswordId', (q) =>
        q.eq('appPasswordId', args.appPasswordId),
      )
      .collect();
    if (heldByPassword.length >= MAX_LOCKS_PER_APP_PASSWORD) {
      throw new ConvexError({ code: 'RATE_LIMITED' });
    }

    const now = Date.now();

    // Re-check at write time. Two clients racing for an exclusive lock
    // could both pass the lookup; whichever inserts first wins, the
    // other gets 423.
    const existing = await ctx.db
      .query('webdavLocks')
      .withIndex('by_organization_resource', (q) =>
        q.eq('organizationId', args.organizationId).eq('resourcePath', path),
      )
      .first();
    if (existing && existing.expiresAt > now) {
      throw new ConvexError({ code: 'LOCKED' });
    }
    if (existing) await ctx.db.delete(existing._id);

    // RFC 4918 §6.1 (MUST): a depth-infinity lock on an ANCESTOR locks the
    // whole subtree, so a new lock on a descendant must be refused with
    // 423. The exact-path check above misses this because it only looks at
    // `path` itself. Walk each ancestor and reject if any holds an
    // unexpired depth-infinity lock. (v1 advertises exclusive write locks
    // only, so any such ancestor lock conflicts.)
    for (const ancestor of ancestorPaths(path)) {
      const anc = await ctx.db
        .query('webdavLocks')
        .withIndex('by_organization_resource', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('resourcePath', ancestor),
        )
        .first();
      if (anc && anc.depth === 'infinity' && anc.expiresAt > now) {
        throw new ConvexError({ code: 'LOCKED' });
      }
    }

    // RFC 4918 §7.4 (explicit MUST): a new depth-infinity lock must not be
    // granted over a subtree that already contains a lock. Prefix-scan for
    // any unexpired lock strictly under `path/`. '\uffff' bounds the prefix
    // range; resource paths are percent-encoded ASCII so nothing sorts
    // above it.
    if (args.depth === 'infinity') {
      const descendants = await ctx.db
        .query('webdavLocks')
        .withIndex('by_organization_resource', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .gte('resourcePath', path + '/')
            .lt('resourcePath', path + '/\uffff'),
        )
        .collect();
      if (descendants.some((d) => d.expiresAt > now)) {
        throw new ConvexError({ code: 'LOCKED' });
      }
    }

    const timeoutMs = Math.min(args.timeoutMs, MAX_LOCK_TIMEOUT_MS);
    const expiresAt = now + timeoutMs;
    const id = await ctx.db.insert('webdavLocks', {
      organizationId: args.organizationId,
      resourcePath: path,
      lockToken: args.lockToken,
      ownerXml: args.ownerXml,
      depth: args.depth,
      scope: args.scope,
      ownerUserId: args.ownerUserId,
      appPasswordId: args.appPasswordId,
      expiresAt,
    });
    return { _id: id, expiresAt };
  },
});

// RFC 4918 §9.10.2 — LOCK with If: header + empty body refreshes the
// timeout. Caller verifies the If token matches.
//
// Returns the full row so the handler can echo ownerXml / scope / depth
// in the lockdiscovery response (RFC §9.10.5).
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
    return {
      _id: row._id,
      organizationId: row.organizationId,
      resourcePath: row.resourcePath,
      lockToken: row.lockToken,
      ownerXml: row.ownerXml,
      depth: row.depth,
      scope: row.scope,
      ownerUserId: row.ownerUserId,
      expiresAt: newExpiresAt,
    };
  },
});

export const releaseLock = internalMutation({
  args: {
    lockToken: v.string(),
    ownerUserId: v.string(),
    organizationId: v.string(),
    // Optional — when provided we additionally verify the lock applies
    // to the exact path the client tried to UNLOCK. Helps surface
    // misbehaving clients that send the right token against the wrong
    // URL (RFC §9.11.1 requires NOT_FOUND in that case → 409).
    resourcePath: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const row = await ctx.db
      .query('webdavLocks')
      .withIndex('by_token', (q) => q.eq('lockToken', args.lockToken))
      .first();
    // NOT_FOUND (rather than silent 204) per RFC §9.11.1 — handler
    // maps to 409 Conflict. Org and (optional) path mismatch fall into
    // the same bucket: from the client's view the token doesn't apply
    // to this URL, so it's NOT_FOUND.
    if (!row) throw new ConvexError({ code: 'NOT_FOUND' });
    if (row.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    if (args.resourcePath !== undefined) {
      const canonical = canonicalResourcePath(args.resourcePath);
      if (row.resourcePath !== canonical) {
        throw new ConvexError({ code: 'NOT_FOUND' });
      }
    }
    if (row.ownerUserId !== args.ownerUserId) {
      // RFC 4918 §9.11.1: only the lock owner can UNLOCK.
      throw new ConvexError({ code: 'FORBIDDEN' });
    }
    await ctx.db.delete(row._id);
  },
});

// Delete the lock at `resourcePath` AND every lock under `resourcePath/`.
// Called after a successful DELETE/MOVE so a stale lock row can't 423 a
// later recreate of the same path (RFC 4918 §9.6.1: removing a resource
// removes its locks). '\uffff' bounds the prefix range.
export const deleteLocksUnderPath = internalMutation({
  args: {
    organizationId: v.string(),
    resourcePath: v.string(),
  },
  async handler(ctx, args) {
    const path = canonicalResourcePath(args.resourcePath);
    const self = await ctx.db
      .query('webdavLocks')
      .withIndex('by_organization_resource', (q) =>
        q.eq('organizationId', args.organizationId).eq('resourcePath', path),
      )
      .collect();
    const under = await ctx.db
      .query('webdavLocks')
      .withIndex('by_organization_resource', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('resourcePath', path + '/')
          .lt('resourcePath', path + '/\uffff'),
      )
      .collect();
    for (const row of [...self, ...under]) {
      await ctx.db.delete(row._id);
    }
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
