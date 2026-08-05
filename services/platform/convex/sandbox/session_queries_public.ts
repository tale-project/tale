// Public (browser-facing) reads over the sandbox-session subsystem: the
// automation run views' live agent ops, the Settings fleet page
// (sandbox list + quota usage), and the turn-SLO metrics. The internal-only
// reads stay in session_queries.ts.

import { v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { UnauthorizedError } from '../lib/rls/errors';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import type {
  BetterAuthFindManyResult,
  BetterAuthUser,
} from '../members/types';
import {
  readSandboxQuotaPolicy,
  sessionBudgetForOwnerType,
  sessionCapFor,
  type SessionBudget,
} from './quota_policy';
import {
  sessionIdForWorkflowExecution,
  sessionIdForWorkflowRun,
} from './session_naming';
import {
  isLiveSessionStatus,
  sessionOpTimelinePartValidator,
} from './sessions_schema';

/**
 * The live `agent-run` op for an automation's `sandbox` step, so the operator view's
 * stream panel can render the agent's live progress WHILE the step runs (the
 * chat path renders its timeline from the persisted message; an automation run has
 * no message, so the op's `progressText` is the live source). Keyed by
 * (executionId, stepSlug) — the deterministic automation-run session — and gated on
 * ORG membership: automation ops are org-scoped via `ownerType:'workflow_run'`, not
 * thread RLS, so any org member who can see the app's runs can watch. Returns
 * null when the caller isn't a member, no op exists yet, or the step finished
 * (its op is torn down) — the UI then falls back to the step's persisted summary.
 */
export const getAutomationSandboxOp = query({
  args: {
    organizationId: v.string(),
    executionId: v.string(),
    stepSlug: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
        v.literal('cancelled'),
      ),
      progressText: v.optional(v.string()),
      liveTimeline: v.optional(v.array(sessionOpTimelinePartValidator)),
      lastEventAt: v.optional(v.number()),
      agentIdleAt: v.optional(v.number()),
      continuationCount: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      });
    } catch (err) {
      // Non-member / disabled → null (the operator view degrades to the
      // persisted output), mirroring listSandboxesForOrg. Re-throw real errors.
      if (err instanceof UnauthorizedError) return null;
      throw err;
    }

    const stepSessionId = sessionIdForWorkflowRun(
      args.executionId,
      args.stepSlug,
    );
    const workflowSessionId = sessionIdForWorkflowExecution(args.executionId);
    // A WORKFLOW-SCOPED session carries every step's ops under one sessionId,
    // so match this step's execs by execId — the canonical `execId` plus its
    // derived incarnations (`-t<n>` failover, `-summary` re-entry) — or a
    // sibling step's newer op would shadow the one this card is about.
    const stepExecId = `${args.executionId}-${args.stepSlug}`;
    const isThisStepsExec = (execId: string) =>
      execId === stepExecId || execId.startsWith(`${stepExecId}-`);
    for (const sessionId of [workflowSessionId, stepSessionId]) {
      let op = null;
      for await (const candidate of ctx.db
        .query('sandboxSessionOps')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .order('desc')) {
        if (candidate.kind !== 'agent-run') continue;
        if (
          sessionId === workflowSessionId &&
          !isThisStepsExec(candidate.execId)
        ) {
          continue;
        }
        op = candidate;
        break;
      }
      if (!op) continue;
      if (op.organizationId !== args.organizationId) continue;
      return {
        status: op.status,
        ...(op.progressText !== undefined && { progressText: op.progressText }),
        ...(op.liveTimeline !== undefined && { liveTimeline: op.liveTimeline }),
        ...(op.lastEventAt !== undefined && { lastEventAt: op.lastEventAt }),
        ...(op.agentIdleAt !== undefined && { agentIdleAt: op.agentIdleAt }),
        ...(op.continuationCount !== undefined && {
          continuationCount: op.continuationCount,
        }),
      };
    }
    return null;
  },
});

/**
 * What an automation run's `agent` node is DOING inside the sandbox: the
 * harness's live text plus its bounded tool transcript, read from the node's
 * session op (`workflow-agent` kind, written by the agent host's progress
 * sink). The rebuilt engine's runs have no message to render from, so this op
 * row IS the user-facing execution log — the run views and the task subject
 * panel open it as "Agent log".
 *
 * Org-membership gated like {@link getAutomationSandboxOp}: automation runs
 * are org-scoped, so any member who can see the run can watch its agent. The
 * session is keyed by the RUN, and each agent node owns one exec — a nodeId
 * filter is unnecessary and would break on the id the op was written under,
 * so the newest `workflow-agent` op of the run's session wins.
 */
export const getAgentNodeSandboxOp = query({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
  },
  returns: v.union(
    v.object({
      execId: v.string(),
      status: v.union(
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
        v.literal('cancelled'),
      ),
      progressText: v.optional(v.string()),
      liveTimeline: v.optional(v.array(sessionOpTimelinePartValidator)),
      /** The model that read this turn's images, when the polyfill was armed. */
      visionModelRef: v.optional(v.string()),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      lastEventAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) return null;
      throw err;
    }
    const run = await ctx.db.get(args.runId);
    if (!run || run.organizationId !== args.organizationId) return null;

    const sessionId = sessionIdForWorkflowExecution(String(args.runId));
    for await (const op of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .order('desc')) {
      if (op.kind !== 'workflow-agent') continue;
      if (op.organizationId !== args.organizationId) continue;
      return {
        execId: op.execId,
        status: op.status,
        ...(op.progressText !== undefined && { progressText: op.progressText }),
        ...(op.liveTimeline !== undefined && { liveTimeline: op.liveTimeline }),
        ...(op.visionModelRef !== undefined && {
          visionModelRef: op.visionModelRef,
        }),
        startedAt: op.startedAt,
        ...(op.finishedAt !== undefined && { finishedAt: op.finishedAt }),
        ...(op.lastEventAt !== undefined && { lastEventAt: op.lastEventAt }),
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

/** ms in a day — the turn-metrics window unit. */
const TURN_METRICS_DAY_MS = 24 * 60 * 60 * 1000;
/** Cap the reactive aggregation scan so a busy org can't make this query
 * unbounded; a wider history is a batch/export concern, not a live dashboard. */
const TURN_METRICS_MAX_EVENTS = 5000;

function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  const idx = Math.min(Math.max(rank, 0), sortedAsc.length - 1);
  return sortedAsc[idx] ?? 0;
}

/**
 * External-turn SLO for the org over the last `periodDays` — the numbers the
 * plan's release gate tracks: success rate (excluding user cancels), duration
 * p50/p95, timeout rate, and a per-harness breakdown, plus recovered-turn count
 * and in-turn spend. Aggregated from the durable `sandboxTurnEvents` sidecar
 * (survives session teardown). Admin-gated (developerSettings) like the
 * Sandboxes page; returns null on access-denied so the page renders that state.
 */
export const getExternalTurnMetrics = query({
  args: {
    organizationId: v.string(),
    periodDays: v.optional(v.number()),
  },
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
      if (err instanceof UnauthorizedError) return null;
      throw err;
    }
    if (defineAbilityFor(member.role).cannot('read', 'developerSettings')) {
      return null;
    }

    const periodDays = args.periodDays ?? 7;
    const since = Date.now() - periodDays * TURN_METRICS_DAY_MS;

    let total = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let timeout = 0;
    let recovered = 0;
    let spentCents = 0;
    const durations: number[] = [];
    const byHarness = new Map<
      string,
      { total: number; completed: number; failed: number; timeout: number }
    >();

    for await (const ev of ctx.db
      .query('sandboxTurnEvents')
      .withIndex('by_org_createdAt', (q) =>
        q.eq('organizationId', args.organizationId).gte('createdAt', since),
      )) {
      total += 1;
      durations.push(ev.durationMs);
      if (ev.spentCents !== undefined) spentCents += ev.spentCents;
      if (ev.recovered === true) recovered += 1;
      if (ev.outcome === 'completed') completed += 1;
      else if (ev.outcome === 'failed') failed += 1;
      else if (ev.outcome === 'cancelled') cancelled += 1;
      else timeout += 1;

      const h = byHarness.get(ev.harness) ?? {
        total: 0,
        completed: 0,
        failed: 0,
        timeout: 0,
      };
      h.total += 1;
      if (ev.outcome === 'completed') h.completed += 1;
      else if (ev.outcome === 'failed') h.failed += 1;
      else if (ev.outcome === 'timeout') h.timeout += 1;
      byHarness.set(ev.harness, h);

      if (total >= TURN_METRICS_MAX_EVENTS) break;
    }

    // Success rate excludes user cancels ("非用户取消") — a Stop is not a failure.
    const ratedTotal = completed + failed + timeout;
    durations.sort((a, b) => a - b);

    return {
      periodDays,
      capped: total >= TURN_METRICS_MAX_EVENTS,
      total,
      completed,
      failed,
      cancelled,
      timeout,
      recovered,
      successRate: ratedTotal === 0 ? null : completed / ratedTotal,
      timeoutRate: ratedTotal === 0 ? null : timeout / ratedTotal,
      durationP50Ms: percentile(durations, 50),
      durationP95Ms: percentile(durations, 95),
      spentCents,
      byHarness: [...byHarness.entries()]
        .map(([harness, stats]) =>
          Object.assign({ harness }, stats, {
            successRate:
              stats.completed + stats.failed + stats.timeout === 0
                ? null
                : stats.completed /
                  (stats.completed + stats.failed + stats.timeout),
          }),
        )
        .sort((a, b) => b.total - a.total),
    };
  },
});

/** Recent window that defines a harness's CURRENT health — short, so a harness
 * that just started failing is flagged fast and a harness that recovered clears
 * fast. */
const HARNESS_HEALTH_WINDOW_MS = 30 * 60 * 1000;
/** Below this many recent turns, a harness is "unknown" (not degraded) — a
 * single failure shouldn't trip the breaker. */
const HARNESS_HEALTH_MIN_SAMPLE = 3;
/** Recent failure fraction at/above which the composer shows a degradation hint. */
const HARNESS_HEALTH_FAIL_THRESHOLD = 0.5;
/** Scan cap so the reactive query stays bounded on a busy org. */
const HARNESS_HEALTH_MAX_EVENTS = 2000;

/**
 * Per-harness health for the composer's circuit breaker — the "某 harness 连续
 * 失败时 composer 降级提示" signal. Reads the recent `sandboxTurnEvents` window
 * and flags a harness `degraded` when enough recent turns failed/timed out.
 * Any org member may read it (the picker needs it); a user Stop is NOT a
 * failure. Returns `[]` for a non-member (the composer just shows no hint).
 */
export const getHarnessHealth = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) return [];
      throw err;
    }

    const since = Date.now() - HARNESS_HEALTH_WINDOW_MS;
    const byHarness = new Map<string, { total: number; failures: number }>();
    let scanned = 0;
    for await (const ev of ctx.db
      .query('sandboxTurnEvents')
      .withIndex('by_org_createdAt', (q) =>
        q.eq('organizationId', args.organizationId).gte('createdAt', since),
      )) {
      // A user Stop is not a harness failure — exclude it from the ratio.
      if (ev.outcome === 'cancelled') continue;
      const h = byHarness.get(ev.harness) ?? { total: 0, failures: 0 };
      h.total += 1;
      if (ev.outcome === 'failed' || ev.outcome === 'timeout') h.failures += 1;
      byHarness.set(ev.harness, h);
      scanned += 1;
      if (scanned >= HARNESS_HEALTH_MAX_EVENTS) break;
    }

    return [...byHarness.entries()].map(([harness, stats]) => ({
      harness,
      recentTotal: stats.total,
      recentFailures: stats.failures,
      degraded:
        stats.total >= HARNESS_HEALTH_MIN_SAMPLE &&
        stats.failures / stats.total >= HARNESS_HEALTH_FAIL_THRESHOLD,
    }));
  },
});

/** Warn when in-flight usage reaches this fraction of a budget's cap, so the
 * page flags pressure BEFORE a hard refusal. */
const QUOTA_WARN_FRACTION = 0.8;

/**
 * Per-budget sandbox session usage vs cap for the org — the "配额打满有预警"
 * surface. A session holds a slot while `creating`/`active` (a `stopped` one
 * freed it), so those are what count against the cap, split by the same budget
 * mapping the reserve uses. Reported budgets are project / workflow / render; the
 * `thread` budget still exists in the policy but has no live producer (the
 * per-thread run_code lane is retired), so a forever-empty row would only
 * mislead. Each budget reports `used`, `cap`, `atLimit` (a new session of
 * that kind would be refused), and `nearLimit` (≥80% — the soft warning).
 * Admin-gated (developerSettings) like the Sandboxes page; null on
 * access-denied.
 */
export const getSandboxQuotaUsage = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    try {
      const member = await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      });
      if (defineAbilityFor(member.role).cannot('read', 'developerSettings')) {
        return null;
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) return null;
      throw err;
    }

    const quota = await readSandboxQuotaPolicy(ctx.db, args.organizationId);
    const used: Record<SessionBudget, number> = {
      project: 0,
      thread: 0,
      workflow: 0,
      render: 0,
    };
    // Only creating|active hold a slot (stopped freed it) — the exact set the
    // reserve counts against the cap.
    for (const status of ['creating', 'active'] as const) {
      for await (const row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        used[sessionBudgetForOwnerType(row.ownerType)] += 1;
      }
    }

    const budgets: SessionBudget[] = ['project', 'workflow', 'render'];
    return budgets.map((budget) => {
      const cap = sessionCapFor(budget, quota);
      const u = used[budget];
      return {
        budget,
        used: u,
        cap,
        atLimit: u >= cap,
        nearLimit: cap > 0 && u / cap >= QUOTA_WARN_FRACTION,
      };
    });
  },
});
