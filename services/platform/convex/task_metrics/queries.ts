/**
 * Read surface of the workforce metrics layer: org-level KPIs + trends
 * (workforce dashboard), per-agent scorecards, the needs-attention queues,
 * the operational health strip, and per-project metrics.
 *
 * Everything reads the DAILY ROLLUPS first (taskMetricsDaily /
 * agentTaskMetricsDaily — sums+counts, so re-aggregation here stays exact)
 * plus a few bounded live reads for "right now" state. Auth-gated first;
 * every scan is capped. KPI presentation contract: outcome + intervention +
 * cost always travel together — the UI never shows cost alone.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { readPolicyConfig } from '../governance/helpers';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { checkProjectAccess } from '../tasks/access';
import { dayKeyDaysBefore, utcDayKey } from './rollup_math';

const TREND_MAX_DAYS = 90;
const LIST_CAP = 25;
const HEALTH_SCAN_CAP = 200;

async function requireMember(
  ctx: QueryCtx,
  organizationId: string,
): Promise<{ userId: string; role: string }> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser)
    throw new ConvexError({
      code: 'unauthenticated',
      message: 'Unauthenticated',
    });
  const member = await getOrganizationMember(ctx, organizationId, authUser);
  return { userId: member.userId, role: member.role };
}

function windowKeys(days: number): {
  startKey: string;
  /** Start of the immediately-preceding equal-length window (for deltas). */
  prevStartKey: string;
  todayKey: string;
} {
  const clamped = Math.min(Math.max(days, 1), TREND_MAX_DAYS);
  const todayKey = utcDayKey(Date.now());
  return {
    startKey: dayKeyDaysBefore(todayKey, clamped),
    prevStartKey: dayKeyDaysBefore(todayKey, clamped * 2),
    todayKey,
  };
}

/**
 * Org-wide workforce KPIs + daily trend + agent leaderboard over a window.
 * Rollup-only (zero live scans) — the dashboard's main query.
 */
export const getWorkforceMetrics = query({
  args: {
    organizationId: v.string(),
    days: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const { startKey, prevStartKey } = windowKeys(args.days ?? 30);

    const totals = {
      tasksCreated: 0,
      tasksCompleted: 0,
      tasksCancelled: 0,
      agentCompleted: 0,
      humanCompleted: 0,
      agentRunsStarted: 0,
      agentRunsCompleted: 0,
      agentRunsFailed: 0,
      totalCostCents: 0,
      reviewsPassed: 0,
      reviewsChangesRequested: 0,
      escalations: 0,
      cycleTimeSumMs: 0,
      cycleTimeCount: 0,
      leadTimeSumMs: 0,
      leadTimeCount: 0,
      capped: false,
    };
    // Prior equal-length window — totals only, for the KPI deltas.
    const prevTotals = {
      tasksCompleted: 0,
      agentRunsStarted: 0,
      reviewsPassed: 0,
      reviewsChangesRequested: 0,
      escalations: 0,
      cycleTimeSumMs: 0,
      cycleTimeCount: 0,
      totalCostCents: 0,
    };
    const byDay = new Map<
      string,
      {
        dateKey: string;
        tasksCompleted: number;
        agentRunsStarted: number;
        agentRunsFailed: number;
        totalCostCents: number;
        reviewsPassed: number;
        reviewsChangesRequested: number;
        escalations: number;
      }
    >();

    for await (const row of ctx.db
      .query('taskMetricsDaily')
      .withIndex('by_org_date', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('dateKey', prevStartKey),
      )) {
      if (row.dateKey < startKey) {
        // Prior window — accumulate the delta-relevant totals only.
        prevTotals.tasksCompleted += row.tasksCompleted;
        prevTotals.agentRunsStarted += row.agentRunsStarted;
        prevTotals.reviewsPassed += row.reviewsPassed;
        prevTotals.reviewsChangesRequested += row.reviewsChangesRequested;
        prevTotals.escalations += row.escalations;
        prevTotals.cycleTimeSumMs += row.cycleTimeSumMs;
        prevTotals.cycleTimeCount += row.cycleTimeCount;
        prevTotals.totalCostCents += row.totalCostCents;
        continue;
      }
      totals.tasksCreated += row.tasksCreated;
      totals.tasksCompleted += row.tasksCompleted;
      totals.tasksCancelled += row.tasksCancelled;
      totals.agentCompleted += row.agentCompleted;
      totals.humanCompleted += row.humanCompleted;
      totals.agentRunsStarted += row.agentRunsStarted;
      totals.agentRunsCompleted += row.agentRunsCompleted;
      totals.agentRunsFailed += row.agentRunsFailed;
      totals.totalCostCents += row.totalCostCents;
      totals.reviewsPassed += row.reviewsPassed;
      totals.reviewsChangesRequested += row.reviewsChangesRequested;
      totals.escalations += row.escalations;
      totals.cycleTimeSumMs += row.cycleTimeSumMs;
      totals.cycleTimeCount += row.cycleTimeCount;
      totals.leadTimeSumMs += row.leadTimeSumMs;
      totals.leadTimeCount += row.leadTimeCount;
      totals.capped ||= row.capped;

      const day = byDay.get(row.dateKey) ?? {
        dateKey: row.dateKey,
        tasksCompleted: 0,
        agentRunsStarted: 0,
        agentRunsFailed: 0,
        totalCostCents: 0,
        reviewsPassed: 0,
        reviewsChangesRequested: 0,
        escalations: 0,
      };
      day.tasksCompleted += row.tasksCompleted;
      day.agentRunsStarted += row.agentRunsStarted;
      day.agentRunsFailed += row.agentRunsFailed;
      day.totalCostCents += row.totalCostCents;
      day.reviewsPassed += row.reviewsPassed;
      day.reviewsChangesRequested += row.reviewsChangesRequested;
      day.escalations += row.escalations;
      byDay.set(row.dateKey, day);
    }

    const agents = new Map<
      string,
      {
        agentSlug: string;
        runsStarted: number;
        runsCompleted: number;
        runsFailed: number;
        runDurationSumMs: number;
        runDurationCount: number;
        costCents: number;
        tasksCompleted: number;
        reviewsPassed: number;
        reviewsChangesRequested: number;
        escalations: number;
      }
    >();
    for await (const row of ctx.db
      .query('agentTaskMetricsDaily')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).gte('dateKey', startKey),
      )) {
      const agent = agents.get(row.agentSlug) ?? {
        agentSlug: row.agentSlug,
        runsStarted: 0,
        runsCompleted: 0,
        runsFailed: 0,
        runDurationSumMs: 0,
        runDurationCount: 0,
        costCents: 0,
        tasksCompleted: 0,
        reviewsPassed: 0,
        reviewsChangesRequested: 0,
        escalations: 0,
      };
      agent.runsStarted += row.runsStarted;
      agent.runsCompleted += row.runsCompleted;
      agent.runsFailed += row.runsFailed;
      agent.runDurationSumMs += row.runDurationSumMs;
      agent.runDurationCount += row.runDurationCount;
      agent.costCents += row.costCents;
      agent.tasksCompleted += row.tasksCompleted;
      agent.reviewsPassed += row.reviewsPassed;
      agent.reviewsChangesRequested += row.reviewsChangesRequested;
      agent.escalations += row.escalations;
      agents.set(row.agentSlug, agent);
    }

    return {
      totals,
      previousTotals: prevTotals,
      trend: [...byDay.values()].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey),
      ),
      leaderboard: [...agents.values()].sort(
        (a, b) => b.tasksCompleted - a.tasksCompleted,
      ),
    };
  },
});

/** Per-agent scorecard: window totals + daily trend + recent runs. */
export const getAgentScorecard = query({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    days: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const { startKey, prevStartKey } = windowKeys(args.days ?? 30);

    // Scan from the previous window's start so we can split current vs prior
    // period in one pass — the prior totals power the scorecard's deltas.
    const allRows: Array<Doc<'agentTaskMetricsDaily'>> = [];
    for await (const row of ctx.db
      .query('agentTaskMetricsDaily')
      .withIndex('by_org_agent_date', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug)
          .gte('dateKey', prevStartKey),
      )) {
      allRows.push(row);
    }
    allRows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    const toDay = (row: Doc<'agentTaskMetricsDaily'>) => ({
      dateKey: row.dateKey,
      runsStarted: row.runsStarted,
      runsCompleted: row.runsCompleted,
      runsFailed: row.runsFailed,
      runDurationSumMs: row.runDurationSumMs,
      runDurationCount: row.runDurationCount,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costCents: row.costCents,
      tasksCompleted: row.tasksCompleted,
      reviewsPassed: row.reviewsPassed,
      reviewsChangesRequested: row.reviewsChangesRequested,
      escalations: row.escalations,
      staleEod: row.staleEod,
    });
    const daily = allRows.filter((r) => r.dateKey >= startKey).map(toDay);
    const previousDaily = allRows
      .filter((r) => r.dateKey < startKey)
      .map(toDay);

    const recentRuns = await ctx.db
      .query('taskAgentRuns')
      .withIndex('by_org_agent_started', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .order('desc')
      .take(20);

    return {
      daily,
      previousDaily,
      recentRuns: recentRuns.map((run) => ({
        runId: run._id,
        taskId: run.taskId,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        costCents: run.costCents,
        error: run.error,
      })),
    };
  },
});

/**
 * The dashboard's "needs attention" queues — live state, all bounded:
 * stale in-progress agent tasks, reviews waiting on humans, queued runs,
 * and tripped circuit breakers.
 */
export const getNeedsAttention = query({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const now = Date.now();
    const staleCutoff = now - 24 * 60 * 60 * 1000;

    const staleTasks: Array<{
      taskId: Id<'tasks'>;
      projectId: Id<'projects'>;
      title: string;
      assigneeId?: string;
      staleSinceMs: number;
    }> = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'in_progress'),
      )) {
      if (task.archivedAt || task.assigneeType !== 'agent') continue;
      const lastMove = task.statusChangedAt ?? task.updatedAt;
      if (lastMove >= staleCutoff) continue;
      staleTasks.push({
        taskId: task._id,
        projectId: task.projectId,
        title: task.title,
        assigneeId: task.assigneeId,
        staleSinceMs: lastMove,
      });
      if (staleTasks.length >= LIST_CAP) break;
    }

    const pendingReviews: Array<{
      approvalId: Id<'approvals'>;
      taskId?: string;
      taskTitle?: string;
      projectId?: string;
      agentSlug?: string;
      requestedAt: number;
    }> = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_org_status_resourceType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('status', 'pending')
          .eq('resourceType', 'task_review'),
      )) {
      const metadata =
        approval.metadata && typeof approval.metadata === 'object'
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- jsonRecord
            (approval.metadata as Record<string, unknown>)
          : {};
      const taskIdRaw =
        typeof metadata.taskId === 'string' ? metadata.taskId : undefined;
      const normalized = taskIdRaw
        ? ctx.db.normalizeId('tasks', taskIdRaw)
        : null;
      const task = normalized ? await ctx.db.get(normalized) : null;
      pendingReviews.push({
        approvalId: approval._id,
        taskId: taskIdRaw,
        taskTitle: task?.title,
        projectId:
          typeof metadata.projectId === 'string'
            ? metadata.projectId
            : undefined,
        agentSlug:
          typeof metadata.agentSlug === 'string'
            ? metadata.agentSlug
            : undefined,
        requestedAt: approval._creationTime,
      });
      if (pendingReviews.length >= LIST_CAP) break;
    }

    const queuedRuns: Array<{
      agentSlug: string;
      taskId?: string;
      queuedAt: number;
    }> = [];
    const trippedBreakers: Array<{
      agentSlug: string;
      taskId?: string;
      trippedAt: number;
    }> = [];
    for (const kind of ['concurrency_queued', 'circuit_tripped'] as const) {
      let count = 0;
      for await (const notice of ctx.db
        .query('agentGuardrailNotices')
        .withIndex('by_org_kind_resolved', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('kind', kind)
            .eq('resolvedAt', undefined),
        )) {
        count += 1;
        if (count > LIST_CAP) break;
        const entry = {
          agentSlug: notice.agentSlug,
          taskId: notice.taskId ? String(notice.taskId) : undefined,
        };
        if (kind === 'concurrency_queued') {
          queuedRuns.push({ ...entry, queuedAt: notice.createdAt });
        } else {
          trippedBreakers.push({ ...entry, trippedAt: notice.createdAt });
        }
      }
    }

    return { staleTasks, pendingReviews, queuedRuns, trippedBreakers };
  },
});

/**
 * Operational health strip: is automation on, are pack executions failing,
 * are runs failing/timing out, how stale is the queue. Bounded (≤~700 docs)
 * and reactive only while the dashboard is open.
 */
export const getWorkforceHealth = query({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const automationRaw = await readPolicyConfig<{ enabled?: boolean }>(
      ctx,
      args.organizationId,
      'task_automation',
    );
    const automationEnabled = automationRaw?.enabled !== false;

    let runsFailed24h = 0;
    let runsTimedOut24h = 0;
    let runsStarted24h = 0;
    let scanned = 0;
    for await (const run of ctx.db
      .query('taskAgentRuns')
      .withIndex('by_org_started', (q) =>
        q.eq('organizationId', args.organizationId).gt('startedAt', dayAgo),
      )) {
      scanned += 1;
      if (scanned > HEALTH_SCAN_CAP) break;
      runsStarted24h += 1;
      if (run.status === 'failed') runsFailed24h += 1;
      if (run.status === 'timed_out') runsTimedOut24h += 1;
    }

    // Pack execution failures in the last 24h, via the org-scoped
    // status index (one bounded probe per pack workflow).
    let packFailures24h = 0;
    const packSubscriptions = await ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(100);
    const packSlugs = [
      ...new Set(
        packSubscriptions
          .map((sub) => sub.workflowSlug)
          .filter(
            (slug): slug is string =>
              typeof slug === 'string' && slug.startsWith('tasks/'),
          ),
      ),
    ];
    for (const slug of packSlugs) {
      const failures = await ctx.db
        .query('wfExecutions')
        .withIndex('by_org_workflowSlug_status', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('workflowSlug', slug)
            .eq('status', 'failed'),
        )
        .order('desc')
        .take(10);
      packFailures24h += failures.filter(
        (execution) => execution.startedAt > dayAgo,
      ).length;
    }

    let oldestQueuedMs: number | undefined;
    for await (const notice of ctx.db
      .query('agentGuardrailNotices')
      .withIndex('by_org_kind_resolved', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('kind', 'concurrency_queued')
          .eq('resolvedAt', undefined),
      )) {
      oldestQueuedMs = notice.createdAt;
      break; // index order = oldest first
    }

    return {
      automationEnabled,
      runsStarted24h,
      runsFailed24h,
      runsTimedOut24h,
      runsScanCapped: scanned > HEALTH_SCAN_CAP,
      packFailures24h,
      oldestQueuedMs,
      // External runtimes land with the runtimes milestone.
      runtimesOffline: 0,
    };
  },
});

/** Per-project metrics: rollup window for the project's metrics tab. */
export const getProjectTaskMetrics = query({
  args: {
    projectId: v.id('projects'),
    days: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    const { userId, role } = await requireMember(ctx, project.organizationId);
    const teamIds = await getUserTeamIds(ctx, userId);
    const access = checkProjectAccess(project, teamIds, role);
    if (!access.canRead) return null;

    const { startKey, prevStartKey } = windowKeys(args.days ?? 30);
    // Scan from the previous window's start; split current vs prior period so
    // the metrics tab can show period-over-period deltas.
    const allRows: Array<Doc<'taskMetricsDaily'>> = [];
    for await (const row of ctx.db
      .query('taskMetricsDaily')
      .withIndex('by_org_project_date', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId)
          .gte('dateKey', prevStartKey),
      )) {
      allRows.push(row);
    }
    allRows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    const toDay = (row: Doc<'taskMetricsDaily'>) => ({
      dateKey: row.dateKey,
      tasksCreated: row.tasksCreated,
      tasksCompleted: row.tasksCompleted,
      tasksCancelled: row.tasksCancelled,
      cycleTimeSumMs: row.cycleTimeSumMs,
      cycleTimeCount: row.cycleTimeCount,
      leadTimeSumMs: row.leadTimeSumMs,
      leadTimeCount: row.leadTimeCount,
      statusCountsEod: row.statusCountsEod,
      wipEod: row.wipEod,
      overdueEod: row.overdueEod,
      staleEod: row.staleEod,
      agentCompleted: row.agentCompleted,
      humanCompleted: row.humanCompleted,
      agentRunsStarted: row.agentRunsStarted,
      agentRunsFailed: row.agentRunsFailed,
      totalCostCents: row.totalCostCents,
      reviewsPassed: row.reviewsPassed,
      reviewsChangesRequested: row.reviewsChangesRequested,
      escalations: row.escalations,
      capped: row.capped,
    });

    return {
      daily: allRows.filter((r) => r.dateKey >= startKey).map(toDay),
      previousDaily: allRows.filter((r) => r.dateKey < startKey).map(toDay),
    };
  },
});
