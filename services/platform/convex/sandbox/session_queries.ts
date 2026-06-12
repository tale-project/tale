// Read-side helpers for the session subsystem (default Convex runtime).

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { isLiveSessionStatus } from './sessions_schema';

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

/** Running ops for a thread, as {sessionId, execId} — the Stop path cancels
 * each one's exec in the sandbox. The external-agent turn writes
 * `sandboxSessionOps` (NOT the one-shot `sandboxExecutions` table that
 * cancelExecutionsForThread scans), so this is how Stop reaches the in-sandbox
 * agent process. */
export const listRunningOpsByThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.array(v.object({ sessionId: v.string(), execId: v.string() })),
  handler: async (ctx, args) => {
    const out: { sessionId: string; execId: string }[] = [];
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (row.status === 'running') {
        out.push({ sessionId: row.sessionId, execId: row.execId });
      }
    }
    return out;
  },
});

/** The thread's currently-running agent-run op joined with its session's
 * agentKind — the steer-delivery target. Null when no turn is running. When
 * several ops race (supersede window), the most recently started wins. */
export const getRunningAgentRunByThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({
      sessionId: v.string(),
      execId: v.string(),
      agentKind: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    let latest: {
      sessionId: string;
      execId: string;
      startedAt: number;
    } | null = null;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (row.kind !== 'agent-run' || row.status !== 'running') continue;
      if (latest === null || row.startedAt > latest.startedAt) {
        latest = {
          sessionId: row.sessionId,
          execId: row.execId,
          startedAt: row.startedAt,
        };
      }
    }
    if (latest === null) return null;
    let agentKind: string | undefined;
    for await (const session of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', latest.sessionId))) {
      agentKind = session.agentKind;
      break;
    }
    return {
      sessionId: latest.sessionId,
      execId: latest.execId,
      ...(agentKind !== undefined && { agentKind }),
    };
  },
});

/** Abandoned agent-run ops: `running`, not yet finalized, with a heartbeat
 * gone stale (the draining action died — crash / redeploy / 30min ceiling). The
 * recovery watchdog finalizes these exactly-once. The heartbeat (not the
 * deadline) is the liveness signal — a live action heartbeats on a fixed
 * interval independent of output. */
export const listAbandonedAgentOps = internalQuery({
  args: { staleBeforeMs: v.number(), limit: v.number() },
  returns: v.array(
    v.object({
      organizationId: v.string(),
      sessionId: v.string(),
      execId: v.string(),
      threadId: v.optional(v.string()),
      assistantMessageId: v.optional(v.string()),
      mintedKeyId: v.optional(v.string()),
      userId: v.optional(v.string()),
      modelRef: v.optional(v.string()),
      agentSlug: v.optional(v.string()),
      streamId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const out = [];
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_status_and_heartbeat', (q) =>
        q.eq('status', 'running').lt('heartbeatAt', args.staleBeforeMs),
      )) {
      if (row.kind !== 'agent-run') continue;
      if (row.finalizedAt !== undefined) continue;
      out.push({
        organizationId: row.organizationId,
        sessionId: row.sessionId,
        execId: row.execId,
        ...(row.threadId !== undefined && { threadId: row.threadId }),
        ...(row.assistantMessageId !== undefined && {
          assistantMessageId: row.assistantMessageId,
        }),
        ...(row.mintedKeyId !== undefined && { mintedKeyId: row.mintedKeyId }),
        ...(row.userId !== undefined && { userId: row.userId }),
        ...(row.modelRef !== undefined && { modelRef: row.modelRef }),
        ...(row.agentSlug !== undefined && { agentSlug: row.agentSlug }),
        ...(row.streamId !== undefined && { streamId: row.streamId }),
      });
      if (out.length >= args.limit) break;
    }
    return out;
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

/** The LIVE session row for a spawner session id, or null. The management-page
 * controls fetch it to confirm the session belongs to the caller's org before
 * acting (defense in depth — the public id is org-scoped at the UI). The
 * reused deterministic sessionId leaves historical terminal rows ahead of the
 * live one in by_sessionId — skip them, so the guard vets the row the control
 * will act on, and a control targeting an id with no live incarnation fails
 * loudly instead of matching an old destroyed record. */
export const getSessionBySessionId = internalQuery({
  args: { sessionId: v.string() },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      ownerType: v.string(),
      ownerId: v.string(),
      status: v.string(),
      pinned: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (!isLiveSessionStatus(row.status)) continue;
      return {
        organizationId: row.organizationId,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        status: row.status,
        ...(row.pinned !== undefined && { pinned: row.pinned }),
      };
    }
    return null;
  },
});

/** Running ops for a session (the live task), for the management-page "Stop"
 * control — cancel every running exec the session currently has. */
export const listRunningOpsBySession = internalQuery({
  args: { sessionId: v.string() },
  returns: v.array(v.object({ sessionId: v.string(), execId: v.string() })),
  handler: async (ctx, args) => {
    const out: { sessionId: string; execId: string }[] = [];
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.status === 'running') {
        out.push({ sessionId: row.sessionId, execId: row.execId });
      }
    }
    return out;
  },
});
