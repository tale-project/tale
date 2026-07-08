/**
 * Read surface of the task metrics layer. Everything reads the DAILY ROLLUPS
 * (taskMetricsDaily — sums+counts, so re-aggregation here stays exact).
 * Auth-gated first; every scan is capped. KPI presentation contract: outcome +
 * intervention + cost always travel together — the UI never shows cost alone.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { checkProjectAccess } from '../tasks/access';
import { dayKeyDaysBefore, utcDayKey } from './rollup_math';

const TREND_MAX_DAYS = 90;

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
