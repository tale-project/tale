// Public (browser-facing) read of a thread's live external-agent progress.
// The internal-only reads stay in session_queries.ts; this file holds the one
// query the chat UI subscribes to via useQuery, gated by the same thread RLS
// the message queries use.

import { v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { UnauthorizedError } from '../lib/rls/errors';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import type {
  BetterAuthFindManyResult,
  BetterAuthUser,
} from '../members/types';
import { userOwnerId } from './session_naming';
import { isLiveSessionStatus } from './sessions_schema';

/**
 * Latest in-session `agent-run` op for a thread, for live tool-use/text
 * rendering while an external-agent turn is in flight. Returns null when the
 * caller can't access the thread or no op exists yet — the UI then falls back
 * to its plain "Thinking…" placeholder. `recentEvents` are JSON-stringified
 * AgentEvents (the frontend maps them to thought-timeline steps).
 */
export const getActiveSessionOp = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
        v.literal('cancelled'),
      ),
      progressText: v.optional(v.string()),
      recentEvents: v.optional(v.array(v.string())),
      agentSessionId: v.optional(v.string()),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      lastEventAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    // Same allow-list the thread message queries enforce — don't let a bare
    // threadId leak another user's/org's session progress.
    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) return null;

    // Scope by thread, not session id — a per-user sandbox serves many threads
    // from one session, so the live op for THIS chat is found by threadId.
    let latest: {
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      progressText?: string;
      recentEvents?: string[];
      agentSessionId?: string;
      startedAt: number;
      finishedAt?: number;
      lastEventAt?: number;
    } | null = null;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (row.kind !== 'agent-run') continue;
      if (latest === null || row.startedAt > latest.startedAt) {
        latest = {
          status: row.status,
          ...(row.progressText !== undefined && {
            progressText: row.progressText,
          }),
          ...(row.recentEvents !== undefined && {
            recentEvents: row.recentEvents,
          }),
          ...(row.agentSessionId !== undefined && {
            agentSessionId: row.agentSessionId,
          }),
          startedAt: row.startedAt,
          ...(row.finishedAt !== undefined && { finishedAt: row.finishedAt }),
          ...(row.lastEventAt !== undefined && {
            lastEventAt: row.lastEventAt,
          }),
        };
      }
    }
    return latest;
  },
});

/**
 * The thread's live sandbox-session lifecycle state, for the ambient "Sandbox"
 * status pill in the composer. Returns null when the caller can't access the
 * thread or it has no live sandbox session (a normal chat thread, or one whose
 * sandbox was destroyed). "Running" is NOT derived here — the pill composes
 * this with `getActiveSessionOp` (the live op) client-side.
 *
 * Owner resolution MIRRORS run_external_agent.ts (the turn runtime): a sandbox
 * is owned per (org, user) — `userOwnerId(org, userId)` — with a thread-owned
 * fallback when there's no userId/org. Keying off the THREAD's userId (not the
 * viewer's) means an org co-member who opened a shared thread sees the OWNER's
 * sandbox state. That parity is intentional, not an oversight: `canAccessThread`
 * already admits exactly that audience, and `getActiveSessionOp` above already
 * exposes the higher-sensitivity live op (tool names, progress text) to them.
 * These four lifecycle fields carry no sessionId / key / workspace content, so
 * they're strictly less sensitive — not a new disclosure.
 */
export const getThreadSandboxState = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal('creating'),
        v.literal('active'),
        v.literal('degraded'),
        v.literal('stopped'),
      ),
      pinned: v.boolean(),
      agentKind: v.union(v.string(), v.null()),
      lastActivityAt: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) return null;

    // Owner key must match the turn runtime (run_external_agent.ts) exactly, or
    // this reads a different row than the one the agent runs in: user-owned
    // (org, user) when both are present, else the thread-owned fallback. The
    // literals mirror its OWNER_TYPE_USER / OWNER_TYPE_THREAD constants.
    const userOwned = Boolean(metadata.userId && metadata.organizationId);
    const ownerType = userOwned ? 'user' : 'thread';
    const ownerId =
      userOwned && metadata.userId && metadata.organizationId
        ? userOwnerId(metadata.organizationId, metadata.userId)
        : args.threadId;

    // Single indexed read on by_owner. The deterministic per-(org,user)
    // sessionId is reused across incarnations, so the index also holds terminal
    // (destroyed/expired/failed) rows for the same owner — isLiveSessionStatus
    // skips them. Inlined rather than calling getActiveSessionByOwner because
    // that helper omits `degraded`, which we surface to the user as "Recovering".
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', ownerType).eq('ownerId', ownerId),
      )) {
      if (!isLiveSessionStatus(row.status)) continue;
      return {
        status: row.status,
        pinned: row.pinned === true,
        agentKind: row.agentKind ?? null,
        lastActivityAt: row.lastActivityAt ?? null,
      };
    }
    return null;
  },
});

/**
 * Fleet view for the sandbox-management page: every live sandbox session in the
 * caller's org, each joined with its current op (the running task, or the most
 * recent one). Gated on the `developerSettings` capability (admin / owner /
 * developer) — the same gate the page nav + the control actions use; a
 * non-privileged member gets null → the page renders an access-denied state.
 *
 * Returns null when unauthenticated/not-a-member/not-privileged; otherwise an
 * array (possibly empty) of session summaries, busy-first then most-recent.
 */
export const listSandboxesForOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    let member;
    try {
      member = await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      });
    } catch (err) {
      // getOrganizationMember throws UnauthorizedError for non-members and
      // disabled accounts; this query's contract is to return null in exactly
      // those cases (the page renders access-denied), like the unauthenticated
      // branch above. Re-throw anything else so real backend errors surface.
      if (err instanceof UnauthorizedError) return null;
      throw err;
    }
    if (defineAbilityFor(member.role).cannot('read', 'developerSettings')) {
      return null;
    }

    const sessions = [];
    for await (const s of ctx.db
      .query('sandboxSessions')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      // Only LIVE sessions are manageable. The deterministic per-(org,user)
      // sessionId is reused across incarnations, so the table holds many
      // historical destroyed/expired/failed rows for the same id — exclude all
      // of them (a never-created `failed` record isn't a sandbox you can act on).
      if (!isLiveSessionStatus(s.status)) continue;

      // Current op = the running one if any, else the most recent by startedAt.
      // Bounded by the session lifetime (idle/TTL-reaped ~24h), so the per-
      // session op scan stays small in practice.
      let current: {
        threadId?: string;
        execId: string;
        status: string;
        continuationCount?: number;
        spentCents?: number;
        pausedReason?: string;
        progressText?: string;
        startedAt: number;
        heartbeatAt?: number;
      } | null = null;
      let busy = false;
      let currentRunning = false;
      // Cumulative spend across every task this sandbox incarnation has run.
      // There's one op row per turn, each carrying that turn's full VK spend
      // (seam writes overwrite within a turn, never accumulate), so the sum is
      // the sandbox's lifetime spend — usageLedger isn't session-keyed, so this
      // is the only per-sandbox source. Non-`agent-run` ops have no spentCents
      // → contribute 0.
      let totalSpentCents = 0;
      for await (const op of ctx.db
        .query('sandboxSessionOps')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', s.sessionId))) {
        totalSpentCents += op.spentCents ?? 0;
        // A finalized op is done even if its status was never flipped off
        // 'running' (the recovery/error paths set finalizedAt + revoke the VK
        // but leave status as-is). Treat finalizedAt as the authoritative
        // done-signal so a recovered/abandoned turn never shows as "busy".
        const isRunning =
          op.status === 'running' && op.finalizedAt === undefined;
        if (isRunning) busy = true;
        const better =
          current === null ||
          (isRunning && !currentRunning) ||
          (isRunning === currentRunning && op.startedAt > current.startedAt);
        if (better) {
          currentRunning = isRunning;
          current = {
            execId: op.execId,
            status: op.status,
            startedAt: op.startedAt,
            ...(op.threadId !== undefined && { threadId: op.threadId }),
            ...(op.continuationCount !== undefined && {
              continuationCount: op.continuationCount,
            }),
            ...(op.spentCents !== undefined && { spentCents: op.spentCents }),
            ...(op.pausedReason !== undefined && {
              pausedReason: op.pausedReason,
            }),
            ...(op.progressText !== undefined && {
              progressText: op.progressText.slice(-280),
            }),
            ...(op.heartbeatAt !== undefined && {
              heartbeatAt: op.heartbeatAt,
            }),
          };
        }
      }

      sessions.push({
        sessionId: s.sessionId,
        ownerType: s.ownerType,
        ownerId: s.ownerId,
        createdBy: s.createdBy,
        ownerName: null as string | null,
        ownerEmail: null as string | null,
        agentKind: s.agentKind ?? null,
        status: s.status,
        pinned: s.pinned === true,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastActivityAt: s.lastActivityAt ?? null,
        busy,
        totalSpentCents,
        currentOp: current,
      });
    }

    // Resolve owner ids → display name + email in ONE batched Better Auth `in`
    // query (a Map join, no N+1). `createdBy` is the user id; a session with no
    // resolvable user (system-owned / deleted user) keeps the id fallback.
    const userIds = [...new Set(sessions.map((s) => s.createdBy))].filter(
      Boolean,
    );
    if (userIds.length > 0) {
      try {
        const usersResult: BetterAuthFindManyResult<BetterAuthUser> =
          await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: { cursor: null, numItems: userIds.length },
            where: [{ field: '_id', value: userIds, operator: 'in' }],
          });
        const byId = new Map<string, BetterAuthUser>();
        for (const u of usersResult?.page ?? []) byId.set(u._id, u);
        for (const s of sessions) {
          const u = byId.get(s.createdBy);
          if (u) {
            s.ownerName = u.name ?? null;
            s.ownerEmail = u.email ?? null;
          }
        }
      } catch (err) {
        console.warn('[listSandboxesForOrg] owner resolution failed:', err);
      }
    }

    sessions.sort((a, b) => {
      if (a.busy !== b.busy) return a.busy ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
    return sessions;
  },
});
