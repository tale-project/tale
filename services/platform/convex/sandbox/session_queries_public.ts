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
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import type {
  BetterAuthFindManyResult,
  BetterAuthUser,
} from '../members/types';

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
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    });
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
      if (
        s.status !== 'active' &&
        s.status !== 'creating' &&
        s.status !== 'degraded'
      ) {
        continue;
      }

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
      for await (const op of ctx.db
        .query('sandboxSessionOps')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', s.sessionId))) {
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
