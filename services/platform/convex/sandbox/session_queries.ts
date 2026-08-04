// Read-side helpers for the session subsystem (default Convex runtime).

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getUserById } from '../betterAuth/trusted_headers/get_user_by_id';
import { isLiveSessionStatus } from './sessions_schema';
import { sandboxSessionProfileValidator } from './wire';

/**
 * Resolve a minted session token by its sha256 hash (see `hashVirtualKey`).
 *
 * The connector-dispatch httpAction authenticates the in-container MCP bridge
 * by hashing the presented per-session key and looking it up here, then reads
 * `organizationId` + `scope.connectorGrants` FROM THIS ROW — never from the
 * request body — so a container cannot spoof another org or widen its own
 * grants. Returns null when no row matches; callers MUST still check
 * `revokedAt` and `expiresAt` before trusting the row.
 */
export const getSessionTokenByHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query('sandboxSessionTokens')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
      .first(),
});

/** The live (creating|active|stopped) session owned by an entity, or null.
 * Used by the work lanes (task-agent runs, automation agent nodes) to reuse
 * an owner's session across turns, and by session teardown to find it.
 * Includes `stopped` (hibernated, workspace preserved) so a turn RESUMES it
 * in place rather than falling through to a fresh empty sandbox. */
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
      if (
        row.status === 'creating' ||
        row.status === 'active' ||
        row.status === 'stopped'
      ) {
        return row;
      }
    }
    return null;
  },
});

/** The durable finalize context for one exec's op row (point lookup by
 * (sessionId, execId)). A turn's finalize reads `mintedKeyId` here — its
 * single source of truth for the gateway VK to revoke — so the same value the
 * recovery watchdogs read also drives the live finalize, with no copy carried
 * elsewhere. Null when the op row is gone (already reaped). */
export const getExternalTurnOpForFinalize = internalQuery({
  args: { sessionId: v.string(), execId: v.string() },
  returns: v.union(
    v.object({
      mintedKeyId: v.optional(v.string()),
      finalizedAt: v.optional(v.number()),
      /** Turn start — the finalize computes durationMs = now - startedAt for the
       * turn-SLO event. */
      startedAt: v.optional(v.number()),
      /** 'watchdog' when a crash-recovery sweep re-attached this turn — recorded
       * as `recovered` on the turn event. */
      resumedBy: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId_and_execId', (q) =>
        q.eq('sessionId', args.sessionId).eq('execId', args.execId),
      )
      .first();
    if (!row) return null;
    return {
      ...(row.mintedKeyId !== undefined && { mintedKeyId: row.mintedKeyId }),
      ...(row.finalizedAt !== undefined && { finalizedAt: row.finalizedAt }),
      startedAt: row.startedAt,
      ...(row.resumedBy !== undefined && { resumedBy: row.resumedBy }),
    };
  },
});

/** The SESSION's currently-running agent-run op joined with its session's
 * agentKind — the steer target for a WORKFLOW task run (keyed by the
 * deterministic (executionId, stepSlug) session id, which has no threadId).
 * Null when no agent turn is live in the session. Carries the
 * `agentIdleAt` linger marker a file-stage must respect. */
export const getRunningAgentRunBySession = internalQuery({
  args: { sessionId: v.string() },
  returns: v.union(
    v.object({
      sessionId: v.string(),
      execId: v.string(),
      agentKind: v.optional(v.string()),
      agentIdleAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    let latest: {
      execId: string;
      startedAt: number;
      agentIdleAt?: number;
    } | null = null;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (row.kind !== 'agent-run' || row.status !== 'running') continue;
      if (latest === null || row.startedAt > latest.startedAt) {
        latest = {
          execId: row.execId,
          startedAt: row.startedAt,
          ...(row.agentIdleAt !== undefined && {
            agentIdleAt: row.agentIdleAt,
          }),
        };
      }
    }
    if (latest === null) return null;
    let agentKind: string | undefined;
    for await (const session of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      agentKind = session.agentKind;
      break;
    }
    return {
      sessionId: args.sessionId,
      execId: latest.execId,
      ...(agentKind !== undefined && { agentKind }),
      ...(latest.agentIdleAt !== undefined && {
        agentIdleAt: latest.agentIdleAt,
      }),
    };
  },
});

/** Live sessions in an org whose container *should* be running (active or
 * degraded, not pinned) — the candidates the management-page reconcile probes
 * to flip to `stopped` once the spawner has released them. Excludes `creating`
 * (mid-spin-up; a false-negative liveness probe would wrongly hibernate it) and
 * `stopped` (already reconciled). */
export const listReconcilableSessionsForOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.object({ sessionId: v.string() })),
  handler: async (ctx, args) => {
    const out: { sessionId: string }[] = [];
    for (const status of ['active', 'degraded'] as const) {
      for await (const row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        if (row.pinned === true) continue;
        out.push({ sessionId: row.sessionId });
      }
    }
    return out;
  },
});

/**
 * All `active`/`degraded` session rows across EVERY org — the drift-reconcile
 * cron's candidates. Unlike the per-org page-mount reconcile, this INCLUDES
 * pinned rows: the cron re-asserts a pin the spawner drops on restart (its
 * registry rebuilds without it), and recreates a pinned container that went
 * missing, so "always-on" survives a control-plane bounce. Carries `pinned` +
 * `profile` so the action decides re-push vs recreate vs hibernate without a
 * second read. Bounded by `limit`; scans `by_status` (global) like
 * `recoverStuckSessions`. Excludes `creating` (mid-spin-up) and `stopped`
 * (already reconciled / deliberately hibernated). */
export const listSessionsToReconcile = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      organizationId: v.string(),
      sessionId: v.string(),
      pinned: v.boolean(),
      profile: sandboxSessionProfileValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const out: Array<{
      organizationId: string;
      sessionId: string;
      pinned: boolean;
      profile: 'default' | 'agent';
    }> = [];
    for (const status of ['active', 'degraded'] as const) {
      for await (const row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_status', (q) => q.eq('status', status))) {
        out.push({
          organizationId: row.organizationId,
          sessionId: row.sessionId,
          pinned: row.pinned === true,
          profile: row.profile,
        });
        if (out.length >= args.limit) return out;
      }
    }
    return out;
  },
});

/** Live `workflow_run` sessions belonging to ONE automation run. Every
 * step's ephemeral sandbox is keyed `${executionId}:${stepSlug}` on `ownerId`
 * (see `workflowRunOwnerId`), so they all share the `${executionId}:` prefix —
 * scanned here via a range on the `by_owner` index. Used by the user-Stop
 * cascade to tear them ALL down at once: `cancelExecution` cancels the durable
 * run but never touches the sandbox, so without this a stopped run's agent
 * keeps running and its session keeps holding a per-org slot until the TTL
 * reaper — wedging the org's capacity queue. The org filter is defensive (the
 * executionId already makes the prefix globally unique). */
export const listAutomationRunSessionsForExecution = internalQuery({
  args: { organizationId: v.string(), executionId: v.string() },
  returns: v.array(v.object({ sessionId: v.string() })),
  handler: async (ctx, args) => {
    const lower = `${args.executionId}:`;
    const upper = `${args.executionId};`; // ';' = ':' + 1 → captures every step
    const out: { sessionId: string }[] = [];
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q
          .eq('ownerType', 'workflow_run')
          .gte('ownerId', lower)
          .lt('ownerId', upper),
      )) {
      if (row.organizationId !== args.organizationId) continue;
      if (!isLiveSessionStatus(row.status)) continue;
      out.push({ sessionId: row.sessionId });
    }
    return out;
  },
});

/** Ephemeral `workflow_run` sessions whose bounded TTL has elapsed (`now >
 * expiresAt`) and that aren't pinned — the opportunistic backstop the next
 * `sandbox`-step run reaps before creating its own. The happy path tears these
 * down in its `finally`; this catches the rare hard-kill that skipped it.
 * Scans active/degraded/stopped (a stopped row still holds a workspace + a live
 * VK), ordered by the org+status index, bounded by `limit`. */
export const listStaleAutomationRunSessions = internalQuery({
  args: { organizationId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ sessionId: v.string() })),
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = args.limit ?? 10;
    const out: { sessionId: string }[] = [];
    for (const status of ['active', 'degraded', 'stopped'] as const) {
      for await (const row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        if (row.ownerType !== 'workflow_run') continue;
        if (row.pinned === true) continue;
        if (now <= row.expiresAt) continue;
        out.push({ sessionId: row.sessionId });
        if (out.length >= limit) return out;
      }
    }
    return out;
  },
});

/** The durable resume checkpoint for a workflow `sandbox`-step session, or null.
 * `runSandboxAgent` reads this on entry: present ⇒ a prior segment handed off,
 * so RE-ATTACH from this cursor (skip session create / cred injection / mint);
 * absent ⇒ a fresh run. One row per deterministic session. */
export const loadAgentCheckpoint = internalQuery({
  args: { sessionId: v.string() },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      sessionId: v.string(),
      execId: v.string(),
      lastSeq: v.number(),
      agentSessionId: v.optional(v.string()),
      agentResultSeen: v.optional(v.boolean()),
      agentIdle: v.optional(v.boolean()),
      pendingTaskIds: v.optional(v.array(v.string())),
      apiErrorSeen: v.optional(v.boolean()),
      taskRunId: v.optional(v.id('taskAgentRuns')),
      startedAt: v.number(),
      continuationCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    for await (const row of ctx.db
      .query('sandboxAgentCheckpoints')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      return {
        organizationId: row.organizationId,
        sessionId: row.sessionId,
        execId: row.execId,
        lastSeq: row.lastSeq,
        ...(row.agentSessionId !== undefined && {
          agentSessionId: row.agentSessionId,
        }),
        ...(row.agentResultSeen !== undefined && {
          agentResultSeen: row.agentResultSeen,
        }),
        ...(row.agentIdle !== undefined && { agentIdle: row.agentIdle }),
        ...(row.pendingTaskIds !== undefined && {
          pendingTaskIds: row.pendingTaskIds,
        }),
        ...(row.apiErrorSeen !== undefined && {
          apiErrorSeen: row.apiErrorSeen,
        }),
        ...(row.taskRunId !== undefined && { taskRunId: row.taskRunId }),
        startedAt: row.startedAt,
        continuationCount: row.continuationCount,
      };
    }
    return null;
  },
});

/**
 * The accumulated cross-segment live transcript on an automation-run op — the seed
 * a durable run's NEXT segment carries forward so the op never blanks at a seam.
 * Read on the resume branch of `runSandboxAgent` (the op, not the bounded
 * checkpoint table, is the single store for the transcript). Returns the newest
 * `agent-run` op's `liveTimeline` (the deterministic id can be reused across
 * incarnations, so order desc + filter on `kind`), or `[]` when there is none.
 */
export const loadAutomationOpLiveTimeline = internalQuery({
  args: { sessionId: v.string() },
  returns: v.array(
    v.object({
      type: v.string(),
      text: v.optional(v.string()),
      state: v.optional(v.string()),
      toolCallId: v.optional(v.string()),
      input: v.optional(v.any()),
      output: v.optional(v.any()),
      errorText: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const op = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .order('desc')
      .filter((q) => q.eq(q.field('kind'), 'agent-run'))
      .first();
    return op?.liveTimeline ?? [];
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

/** The live session's owner resolved to a git-identity-shaped fact: the
 * platform user's display name + email, from the row's `createdBy`. The
 * credential broker injects this beside the credential helper so a fresh
 * container's `git commit` has an author without any in-session `git
 * config`. `createdBy` is a real Better Auth user id for chat/thread-owned
 * sessions but a synthetic sentinel ('system', 'workflow', …) for
 * automation-owned ones — those don't resolve to a user and return null so
 * the caller skips injection instead of inventing an identity. Same for a
 * resolved user with a blank name or email (git needs both). */
export const getSessionOwnerIdentity = internalQuery({
  args: { sessionId: v.string() },
  returns: v.union(v.object({ name: v.string(), email: v.string() }), v.null()),
  handler: async (ctx, args) => {
    let createdBy: string | null = null;
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))) {
      if (!isLiveSessionStatus(row.status)) continue;
      createdBy = row.createdBy;
      break;
    }
    if (!createdBy) return null;
    const user = await getUserById(ctx, createdBy);
    if (!user) return null;
    const email = (user.email ?? '').trim();
    const name = (user.name ?? '').trim() || email;
    if (!name || !email) return null;
    return { name, email };
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
