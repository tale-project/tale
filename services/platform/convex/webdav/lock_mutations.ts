import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
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
    const now = Date.now();

    // Per-app-password lock cap (a flood guard, not a brute-force window).
    // Opportunistically evict THIS app-password's expired rows, then count
    // only live locks — otherwise a client that legitimately churns many
    // short-lived locks stays permanently wedged at 503 until each stale path
    // happens to be re-read or the password is revoked (the by_expiresAt index
    // has no GC sweep). RATE_LIMITED → handler returns 503.
    const heldByPassword = await ctx.db
      .query('webdavLocks')
      .withIndex('by_appPasswordId', (q) =>
        q.eq('appPasswordId', args.appPasswordId),
      )
      .collect();
    let liveCount = 0;
    for (const row of heldByPassword) {
      if (row.expiresAt <= now) {
        await ctx.db.delete(row._id);
      } else {
        liveCount++;
      }
    }
    if (liveCount >= MAX_LOCKS_PER_APP_PASSWORD) {
      throw new AppError({ code: 'RATE_LIMITED' });
    }

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
      throw new AppError({ code: 'LOCKED' });
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
        throw new AppError({ code: 'LOCKED' });
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
        throw new AppError({ code: 'LOCKED' });
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
    // RFC 4918 §6.4: only the lock owner may refresh. Defense in depth — the
    // handler also pre-checks, but gating here means the mutation can't be
    // misused to extend another principal's lock.
    ownerUserId: v.string(),
    timeoutMs: v.number(),
  },
  async handler(ctx, args) {
    const row = await ctx.db
      .query('webdavLocks')
      .withIndex('by_token', (q) => q.eq('lockToken', args.lockToken))
      .first();
    if (!row) throw new AppError({ code: 'NOT_FOUND' });
    if (row.expiresAt <= Date.now()) {
      // Stale — clients are supposed to re-LOCK rather than refresh.
      await ctx.db.delete(row._id);
      throw new AppError({ code: 'NOT_FOUND' });
    }
    if (row.ownerUserId !== args.ownerUserId) {
      throw new AppError({ code: 'FORBIDDEN' });
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
    if (!row) throw new AppError({ code: 'NOT_FOUND' });
    if (row.organizationId !== args.organizationId) {
      throw new AppError({ code: 'NOT_FOUND' });
    }
    if (args.resourcePath !== undefined) {
      const canonical = canonicalResourcePath(args.resourcePath);
      if (row.resourcePath !== canonical) {
        throw new AppError({ code: 'NOT_FOUND' });
      }
    }
    if (row.ownerUserId !== args.ownerUserId) {
      // RFC 4918 §9.11.1: only the lock owner can UNLOCK.
      throw new AppError({ code: 'FORBIDDEN' });
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
