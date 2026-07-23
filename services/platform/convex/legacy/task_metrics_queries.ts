/**
 * LEGACY-DATA read surface — home `convex/legacy/`.
 *
 * The task-metrics DOMAIN (`convex/task_metrics/` — the
 * rollup cron that computes `taskMetricsDaily` from live task/agent-run
 * events, its internal mutations/queries) moved wholesale with the
 * agent-metrics rewrite. This file restores only the READ surface —
 * `windowKeys` (pure) and `getProjectTaskMetrics` (a query over the
 * `taskMetricsDaily` table, which still exists — `convex/legacy/schema.ts`,
 * kept so pre-rewrite rollup rows aren't orphaned) — because the Project
 * Metrics tab (`app/features/tasks/components/project-metrics-page.tsx`) is
 * a live, non-AI analytics page that reads it. `tasks/stats.ts`'s
 * `getTaskStatsByProject` also needs `windowKeys` for its rollup-window
 * sums. No NEW rollup rows are produced any more (the cron that wrote them
 * is gone), so these queries only ever surface pre-rewrite history from
 * here on — degrading gracefully to zero/empty once that history ages out
 * of any window, never throwing.
 *
 * A byte-faithful copy of the retired `task_metrics/queries.ts`, with
 * `dayKeyDaysBefore`/`utcDayKey`/`utcDayRange` inlined below (origin comment)
 * from the retired `task_metrics/rollup_math.ts` — that
 * module's OTHER exports (`OPEN_STATUSES`, `clipToDay`, …) feed the rollup
 * cron itself and are not needed here.
 *
 * The registered Convex function path changes from `task_metrics/queries` to
 * `legacy/task_metrics_queries` — `project-metrics-page.tsx`'s
 * `api.task_metrics.queries.getProjectTaskMetrics` reference was repointed to
 * `api.legacy.task_metrics_queries.getProjectTaskMetrics` in the same change.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { checkProjectAccess } from '../tasks/access';

const TREND_MAX_DAYS = 90;

// -----------------------------------------------------------------------------
// retired convex/task_metrics/rollup_math.ts (pure date helpers
// only — the rest of that module fed the now-gone rollup cron)
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** [startMs, endMs) of a UTC day key. Throws on malformed keys. */
function utcDayRange(dateKey: string): {
  startMs: number;
  endMs: number;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`invalid dateKey "${dateKey}" (expected YYYY-MM-DD)`);
  }
  const startMs = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(startMs)) {
    throw new Error(`invalid dateKey "${dateKey}"`);
  }
  return { startMs, endMs: startMs + DAY_MS };
}

/** Day key `days` days before `dateKey` (retention pruning cutoffs). */
function dayKeyDaysBefore(dateKey: string, days: number): string {
  const { startMs } = utcDayRange(dateKey);
  return utcDayKey(startMs - days * DAY_MS);
}

// -----------------------------------------------------------------------------
// retired convex/task_metrics/queries.ts
// -----------------------------------------------------------------------------

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

export function windowKeys(days: number): {
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
