// Read-side helpers for the session subsystem (default Convex runtime).

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

/** The active (creating|active) session owned by an entity, or null. Used by
 * the external-agent turn to reuse a thread's session across turns. */
export const getActiveSessionByOwner = internalQuery({
  args: {
    ownerType: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', args.ownerType).eq('ownerId', args.ownerId),
      )) {
      if (row.status === 'creating' || row.status === 'active') return row;
    }
    return null;
  },
});

/** The most recent captured agent session id for a THREAD (for --resume), or
 * null.
 *
 * A per-user sandbox serves many threads from one session, so the resume handle
 * is scoped by `threadId` — thread T continues T's own Claude conversation, not
 * another thread's, even though they share the container's CLAUDE_CONFIG_DIR.
 *
 * `sinceStartedAt` additionally bounds the lookup to the CURRENT session row's
 * lifetime: a destroyed + recreated sandbox (same deterministic id, workspace
 * wiped) must not resume a prior incarnation's conversation — pass the active
 * session row's `createdAt`. Ops are queried by `by_threadId`; pre-per-user
 * rows have no `threadId` and are naturally excluded (→ no stale resume). */
export const latestAgentSessionId = internalQuery({
  args: {
    threadId: v.string(),
    sinceStartedAt: v.optional(v.number()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const since = args.sinceStartedAt ?? 0;
    let latest: { startedAt: number; agentSessionId?: string } | null = null;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (
        row.agentSessionId &&
        row.startedAt >= since &&
        (latest === null || row.startedAt > latest.startedAt)
      ) {
        latest = {
          startedAt: row.startedAt,
          agentSessionId: row.agentSessionId,
        };
      }
    }
    return latest?.agentSessionId ?? null;
  },
});

/** All active/creating sessions owned by an entity (for the thread-delete
 * cascade — destroy every session a thread owns). */
export const listActiveSessionsByOwner = internalQuery({
  args: { ownerType: v.string(), ownerId: v.string() },
  handler: async (ctx, args) => {
    const out = [];
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', args.ownerType).eq('ownerId', args.ownerId),
      )) {
      if (row.status !== 'destroyed' && row.status !== 'expired') out.push(row);
    }
    return out;
  },
});
