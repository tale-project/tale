/**
 * Daily task-metrics rollup — the snapshot layer behind the workforce
 * dashboard, agent scorecards, and project metrics.
 *
 * `rollupOrgDay` recomputes ONE (org, UTC day) pair whole — delete-and-
 * rewrite of the `taskMetricsDaily` (per project) and `agentTaskMetricsDaily`
 * (per agent) rows — so re-running it is always safe (idempotent recompute,
 * the ops "recomputeDay" lever). Sources are scanned under hard caps; a day
 * that hits a cap is stamped `capped: true` (numbers become lower bounds)
 * and logged `[WorkforceRollup]`.
 *
 * `runDailyRollup` (03:00 UTC cron) sweeps all organizations in pages of
 * `MAX_ORGS_PER_RUN`, chaining itself with the Better Auth pagination cursor
 * so 1K-org fleets stay within action limits. Each org visit also heals
 * stuck runs and prunes rollup rows older than `ROLLUP_RETENTION_DAYS`
 * (aggregates carry no subject PII — fixed retention, not org-tunable).
 *
 * EOD snapshot fields (cumulative flow, WIP, overdue, stale) reflect the
 * task table state AT COMPUTE TIME and are therefore only written when
 * rolling up the immediately-previous day (the cron's normal mode);
 * recomputing older days preserves activity-derived numbers but zeroes the
 * snapshot fields — historical end-of-day state is not reconstructable.
 * `blockedEod` is deferred to the dependency-aware metrics pass (always 0
 * in v1).
 */

import { v } from 'convex/values';

import { getString } from '../../lib/utils/type-guards';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from '../_generated/server';
import { TASK_METRIC_ACTIONS } from '../tasks/helpers';
import {
  clipToDay,
  emptyPerStatus,
  isOpenStatus,
  previousUtcDayKey,
  utcDayKey,
  utcDayRange,
  type PerOpenStatus,
} from './rollup_math';

const ROLLUP_SCAN_CAP = 5000;
const CYCLE_LOOKUP_CAP = 50;
const ROLLUP_VERSION = 1;
const ROLLUP_RETENTION_DAYS = 400;
const PRUNE_BATCH = 500;
export const MAX_ORGS_PER_RUN = 200;
const STALE_EOD_MS = 24 * 60 * 60 * 1000;

interface ProjectAccumulator {
  tasksCreated: number;
  tasksCompleted: number;
  tasksCancelled: number;
  cycleTimeSumMs: number;
  cycleTimeCount: number;
  leadTimeSumMs: number;
  leadTimeCount: number;
  timeInStatusMs: PerOpenStatus;
  timeInStatusExits: PerOpenStatus;
  statusCountsEod: PerOpenStatus;
  wipEod: number;
  blockedEod: number;
  overdueEod: number;
  staleEod: number;
  agentCompleted: number;
  humanCompleted: number;
  agentRunsStarted: number;
  agentRunsCompleted: number;
  agentRunsFailed: number;
  totalCostCents: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
}

interface AgentAccumulator {
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  runDurationSumMs: number;
  runDurationCount: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  tasksCompleted: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
  staleEod: number;
}

function emptyProject(): ProjectAccumulator {
  return {
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksCancelled: 0,
    cycleTimeSumMs: 0,
    cycleTimeCount: 0,
    leadTimeSumMs: 0,
    leadTimeCount: 0,
    timeInStatusMs: emptyPerStatus(),
    timeInStatusExits: emptyPerStatus(),
    statusCountsEod: emptyPerStatus(),
    wipEod: 0,
    blockedEod: 0,
    overdueEod: 0,
    staleEod: 0,
    agentCompleted: 0,
    humanCompleted: 0,
    agentRunsStarted: 0,
    agentRunsCompleted: 0,
    agentRunsFailed: 0,
    totalCostCents: 0,
    reviewsPassed: 0,
    reviewsChangesRequested: 0,
    escalations: 0,
  };
}

function emptyAgent(): AgentAccumulator {
  return {
    runsStarted: 0,
    runsCompleted: 0,
    runsFailed: 0,
    runDurationSumMs: 0,
    runDurationCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    tasksCompleted: 0,
    reviewsPassed: 0,
    reviewsChangesRequested: 0,
    escalations: 0,
    staleEod: 0,
  };
}

function getOrInit<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = init();
    map.set(key, value);
  }
  return value;
}

/** Memoizing task loader — completions/reviews/dwell all need the task doc. */
function taskLoader(
  ctx: MutationCtx,
): (taskId: Id<'tasks'>) => Promise<Doc<'tasks'> | null> {
  const cache = new Map<string, Doc<'tasks'> | null>();
  return async (taskId) => {
    const key = String(taskId);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const task = await ctx.db.get(taskId);
    cache.set(key, task);
    return task;
  };
}

/**
 * The activity row that immediately precedes `row` on the same task —
 * the start of the status segment `row` just ended (dwell computation).
 */
async function previousStatusMark(
  ctx: MutationCtx,
  row: Doc<'taskActivity'>,
): Promise<number | undefined> {
  for await (const prev of ctx.db
    .query('taskActivity')
    .withIndex('by_task', (q) =>
      q.eq('taskId', row.taskId).lt('createdAt', row.createdAt),
    )
    .order('desc')) {
    if (prev.action === 'status.changed' || prev.action === 'created') {
      return prev.createdAt;
    }
  }
  return undefined;
}

/** First transition INTO in_progress — the cycle-time clock start. */
async function firstInProgressAt(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
): Promise<number | undefined> {
  let scanned = 0;
  for await (const row of ctx.db
    .query('taskActivity')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))) {
    scanned += 1;
    if (scanned > CYCLE_LOOKUP_CAP) return undefined;
    if (row.action === 'status.changed' && row.toValue === 'in_progress') {
      return row.createdAt;
    }
  }
  return undefined;
}

export const rollupOrgDay = internalMutation({
  args: {
    organizationId: v.string(),
    dateKey: v.string(),
    /** Defaults to true only when dateKey is yesterday/today (see header). */
    includeEodSnapshot: v.optional(v.boolean()),
  },
  returns: v.object({
    projects: v.number(),
    agents: v.number(),
    capped: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ projects: number; agents: number; capped: boolean }> => {
    const { startMs, endMs } = utcDayRange(args.dateKey);
    const now = Date.now();
    const includeEod =
      args.includeEodSnapshot ??
      (args.dateKey === utcDayKey(now) ||
        args.dateKey === previousUtcDayKey(now));

    const projects = new Map<string, ProjectAccumulator>();
    const agents = new Map<string, AgentAccumulator>();
    const projectIds = new Map<string, Id<'projects'>>();
    let capped = false;
    const loadTask = taskLoader(ctx);

    const projectAcc = (projectId: Id<'projects'>): ProjectAccumulator => {
      projectIds.set(String(projectId), projectId);
      return getOrInit(projects, String(projectId), emptyProject);
    };
    const agentAcc = (slug: string): AgentAccumulator =>
      getOrInit(agents, slug, emptyAgent);

    // ---- 1) Activity scan: lifecycle, reviews, escalations, dwell --------
    let activityRows = 0;
    for await (const row of ctx.db
      .query('taskActivity')
      .withIndex('by_org_createdAt', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('createdAt', startMs)
          .lt('createdAt', endMs),
      )) {
      activityRows += 1;
      if (activityRows > ROLLUP_SCAN_CAP) {
        capped = true;
        break;
      }
      const proj = projectAcc(row.projectId);
      switch (row.action) {
        case 'created':
          proj.tasksCreated += 1;
          break;
        case 'status.changed': {
          // Dwell: the FROM status' segment ended at this row.
          if (row.fromValue && isOpenStatus(row.fromValue)) {
            const segStart = await previousStatusMark(ctx, row);
            if (segStart !== undefined) {
              proj.timeInStatusMs[row.fromValue] += clipToDay(
                segStart,
                row.createdAt,
                startMs,
                endMs,
              );
            }
            proj.timeInStatusExits[row.fromValue] += 1;
          }
          if (row.toValue === 'done' || row.toValue === 'cancelled') {
            const task = await loadTask(row.taskId);
            if (row.toValue === 'done') {
              proj.tasksCompleted += 1;
              if (task) {
                proj.leadTimeSumMs += Math.max(
                  0,
                  row.createdAt - task.createdAt,
                );
                proj.leadTimeCount += 1;
                const cycleStart = await firstInProgressAt(ctx, row.taskId);
                if (cycleStart !== undefined && cycleStart <= row.createdAt) {
                  proj.cycleTimeSumMs += row.createdAt - cycleStart;
                  proj.cycleTimeCount += 1;
                }
                if (task.assigneeType === 'agent' && task.assigneeId) {
                  proj.agentCompleted += 1;
                  agentAcc(task.assigneeId).tasksCompleted += 1;
                } else {
                  proj.humanCompleted += 1;
                }
              }
            } else {
              proj.tasksCancelled += 1;
            }
          }
          break;
        }
        case TASK_METRIC_ACTIONS.reviewPassed: {
          proj.reviewsPassed += 1;
          const task = await loadTask(row.taskId);
          if (task?.assigneeType === 'agent' && task.assigneeId) {
            agentAcc(task.assigneeId).reviewsPassed += 1;
          }
          break;
        }
        case TASK_METRIC_ACTIONS.reviewChangesRequested: {
          proj.reviewsChangesRequested += 1;
          const task = await loadTask(row.taskId);
          if (task?.assigneeType === 'agent' && task.assigneeId) {
            agentAcc(task.assigneeId).reviewsChangesRequested += 1;
          }
          break;
        }
        case TASK_METRIC_ACTIONS.agentEscalated: {
          proj.escalations += 1;
          if (row.actorType === 'agent') {
            agentAcc(row.actorId).escalations += 1;
          }
          break;
        }
        default:
          break;
      }
    }

    // ---- 2) Run scan: counts, durations, tokens, cost (start-day attribution)
    let runRows = 0;
    for await (const run of ctx.db
      .query('taskAgentRuns')
      .withIndex('by_org_started', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('startedAt', startMs)
          .lt('startedAt', endMs),
      )) {
      runRows += 1;
      if (runRows > ROLLUP_SCAN_CAP) {
        capped = true;
        break;
      }
      const proj = projectAcc(run.projectId);
      const agent = agentAcc(run.agentSlug);
      proj.agentRunsStarted += 1;
      agent.runsStarted += 1;
      proj.totalCostCents += run.costCents;
      agent.costCents += run.costCents;
      agent.inputTokens += run.inputTokens;
      agent.outputTokens += run.outputTokens;
      if (run.status === 'completed') {
        proj.agentRunsCompleted += 1;
        agent.runsCompleted += 1;
        if (run.durationMs !== undefined) {
          agent.runDurationSumMs += run.durationMs;
          agent.runDurationCount += 1;
        }
      } else if (run.status === 'failed' || run.status === 'timed_out') {
        proj.agentRunsFailed += 1;
        agent.runsFailed += 1;
      }
    }

    // ---- 3) EOD snapshot (compute-time state; cron mode only) -------------
    if (includeEod) {
      let taskRows = 0;
      for await (const task of ctx.db
        .query('tasks')
        .withIndex('by_organization', (q) =>
          q.eq('organizationId', args.organizationId),
        )) {
        taskRows += 1;
        if (taskRows > ROLLUP_SCAN_CAP) {
          capped = true;
          break;
        }
        if (task.archivedAt) continue;
        if (!isOpenStatus(task.status)) continue;
        const proj = projectAcc(task.projectId);
        proj.statusCountsEod[task.status] += 1;
        if (task.status === 'in_progress' || task.status === 'in_review') {
          proj.wipEod += 1;
        }
        if (task.dueDate !== undefined && task.dueDate < now) {
          proj.overdueEod += 1;
        }
        const lastMove = task.statusChangedAt ?? task.updatedAt;
        if (task.status === 'in_progress' && lastMove < now - STALE_EOD_MS) {
          proj.staleEod += 1;
          if (task.assigneeType === 'agent' && task.assigneeId) {
            agentAcc(task.assigneeId).staleEod += 1;
          }
        }
      }
    }

    // ---- 4) Idempotent rewrite -------------------------------------------
    for await (const existing of ctx.db
      .query('taskMetricsDaily')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).eq('dateKey', args.dateKey),
      )) {
      await ctx.db.delete(existing._id);
    }
    for await (const existing of ctx.db
      .query('agentTaskMetricsDaily')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).eq('dateKey', args.dateKey),
      )) {
      await ctx.db.delete(existing._id);
    }

    for (const [projectKey, acc] of projects) {
      const projectId = projectIds.get(projectKey);
      if (!projectId) continue;
      await ctx.db.insert('taskMetricsDaily', {
        organizationId: args.organizationId,
        projectId,
        dateKey: args.dateKey,
        ...acc,
        capped,
        computedAt: now,
        version: ROLLUP_VERSION,
      });
    }
    for (const [agentSlug, acc] of agents) {
      await ctx.db.insert('agentTaskMetricsDaily', {
        organizationId: args.organizationId,
        agentSlug,
        dateKey: args.dateKey,
        ...acc,
        computedAt: now,
      });
    }

    if (capped) {
      console.warn('[WorkforceRollup] day capped', {
        organizationId: args.organizationId,
        dateKey: args.dateKey,
        activityRows,
        runRows,
      });
    }
    return { projects: projects.size, agents: agents.size, capped };
  },
});

/** Bounded prune of rollup rows older than the fixed aggregate retention. */
export const pruneOldRollups = internalMutation({
  args: {
    organizationId: v.string(),
    beforeKey: v.string(),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    let deleted = 0;
    for await (const row of ctx.db
      .query('taskMetricsDaily')
      .withIndex('by_org_date', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .lt('dateKey', args.beforeKey),
      )) {
      await ctx.db.delete(row._id);
      deleted += 1;
      if (deleted >= PRUNE_BATCH) return { deleted };
    }
    for await (const row of ctx.db
      .query('agentTaskMetricsDaily')
      .withIndex('by_org_date', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .lt('dateKey', args.beforeKey),
      )) {
      await ctx.db.delete(row._id);
      deleted += 1;
      if (deleted >= PRUNE_BATCH) return { deleted };
    }
    return { deleted };
  },
});

/**
 * 03:00 UTC fleet sweep: roll up YESTERDAY for every organization, heal
 * stuck runs, prune ancient rollups. Pages through orgs with the Better
 * Auth cursor and reschedules itself, so the per-invocation work stays
 * bounded regardless of fleet size.
 */
export const runDailyRollup = internalAction({
  args: {
    cursor: v.optional(v.string()),
    dateKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const dateKey = args.dateKey ?? previousUtcDayKey(Date.now());
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'organization',
      paginationOpts: {
        cursor: args.cursor ?? null,
        numItems: MAX_ORGS_PER_RUN,
      },
      where: [],
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter findMany returns paginated unknown
    const page = result as {
      page?: Array<Record<string, unknown>>;
      isDone?: boolean;
      continueCursor?: string;
    };

    for (const org of page.page ?? []) {
      const organizationId = getString(org, '_id');
      if (!organizationId) continue;
      try {
        await ctx.runMutation(internal.task_metrics.rollup.rollupOrgDay, {
          organizationId,
          dateKey,
        });
        await ctx.runMutation(
          internal.task_metrics.internal_mutations.recoverStuckTaskRuns,
          { organizationId },
        );
        await ctx.runMutation(internal.task_metrics.rollup.pruneOldRollups, {
          organizationId,
          beforeKey: utcDayKey(
            Date.now() - ROLLUP_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          ),
        });
      } catch (error) {
        // One bad org must not stop the fleet sweep.
        console.error('[WorkforceRollup] org rollup failed', {
          organizationId,
          dateKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!page.isDone && page.continueCursor) {
      await ctx.scheduler.runAfter(
        0,
        internal.task_metrics.rollup.runDailyRollup,
        { cursor: page.continueCursor, dateKey },
      );
    }
    return null;
  },
});

/**
 * Ops lever: recompute a span of days for one org (e.g. after a bug fix or
 * for initial backfill — activity-derived fields only for past days; EOD
 * snapshots stay as computed on their own day). Runs newest-first so the
 * most-watched days repair first. Bounded; re-invoke for more days.
 */
export const recomputeDays = internalAction({
  args: {
    organizationId: v.string(),
    endDateKey: v.string(),
    days: v.number(),
  },
  returns: v.object({ recomputed: v.number() }),
  handler: async (ctx, args): Promise<{ recomputed: number }> => {
    const days = Math.min(Math.max(args.days, 1), 90);
    let recomputed = 0;
    for (let offset = 0; offset < days; offset++) {
      const { startMs } = utcDayRange(args.endDateKey);
      const dateKey = utcDayKey(startMs - offset * 24 * 60 * 60 * 1000);
      await ctx.runMutation(internal.task_metrics.rollup.rollupOrgDay, {
        organizationId: args.organizationId,
        dateKey,
      });
      recomputed += 1;
    }
    return { recomputed };
  },
});
