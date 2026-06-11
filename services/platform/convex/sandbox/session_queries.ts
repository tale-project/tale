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

/** The most recent in-session exec's captured agent session id (for --resume),
 * or null.
 *
 * `sinceStartedAt` scopes the lookup to the CURRENT session row's lifetime.
 * The thread session id is deterministic (`thr-<threadId>`), so a destroyed +
 * recreated session reuses the same id string; without this bound the query
 * would return a prior session's `agentSessionId`, whose in-container Claude
 * conversation no longer exists — the next `--resume` then fails immediately
 * with "No conversation found". Pass the active session row's `createdAt`: a
 * fresh session has no ops at/after it (→ null → no resume, correct for an
 * empty workspace); a reused session returns only its own turns' handle. */
export const latestAgentSessionId = internalQuery({
  args: { sessionId: v.string(), sinceStartedAt: v.optional(v.number()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const since = args.sinceStartedAt ?? 0;
    let latest: { startedAt: number; agentSessionId?: string } | null = null;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
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
