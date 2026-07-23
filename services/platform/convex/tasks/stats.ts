/**
 * Issue Desk overview KPIs for one project (the `StatGrid` query).
 *
 * One read model, two sources:
 * - `countsByStatus` is a LIVE walk of the project's tasks (`by_project`,
 *   archived rows skipped, optionally scoped to `externalSystem`), bounded by
 *   {@link TASK_BOARD_CAP} with a `capped` flag — mirroring
 *   `listTasksByProject`'s bounded-scan semantics.
 * - The windowed sums re-aggregate the `taskMetricsDaily` rollups (sums are
 *   stored, never pre-averaged, so re-aggregation stays exact — see
 *   `task_metrics/schema.ts`).
 *
 * ACCEPTED CAVEAT: the rollup-window numbers (`completed7d`/`completed30d`/
 * `created30d`/`reworkRatePct`/`totalCostCents30d`/`agentCompleted30d`/
 * `humanCompleted30d`) are PROJECT-WIDE — the daily rollups are keyed by
 * (org, project, day) and carry no externalSystem dimension, so passing
 * `externalSystem` narrows only the live status counts.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
// Task_metrics/ moved wholesale; windowKeys is restored
// (read-only, self-contained) at convex/legacy/task_metrics_queries.ts.
import { windowKeys } from '../legacy/task_metrics_queries';
import { loadAccessibleProject, TASK_BOARD_CAP } from './queries';

const statusCountsValidator = v.object({
  backlog: v.number(),
  todo: v.number(),
  in_progress: v.number(),
  in_review: v.number(),
  done: v.number(),
  cancelled: v.number(),
});

/**
 * Project KPI stats for the Issue Desk overview tab. Project-ACL gated via
 * `loadAccessibleProject` exactly like every other task read (throws
 * `PROJECT_NOT_FOUND` / `TASK_FORBIDDEN` / the active-org coherence error).
 */
export const getTaskStatsByProject = query({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    // Scope the LIVE status counts to tasks linked to one external system
    // (e.g. 'github'), mirroring `listTasksByProject`. Rollup windows are
    // project-wide regardless — see the module doc comment.
    externalSystem: v.optional(v.string()),
  },
  returns: v.object({
    countsByStatus: statusCountsValidator,
    // True when the live status walk hit TASK_BOARD_CAP — counts are lower
    // bounds. (Distinct from taskMetricsDaily.capped, which is folded into
    // the rollup numbers upstream.)
    capped: v.boolean(),
    openTotal: v.number(),
    completed7d: v.number(),
    completed30d: v.number(),
    created30d: v.number(),
    // reviewsChangesRequested / (reviewsPassed + reviewsChangesRequested)
    // over the 30d window, as a rounded integer percent; 0 when no reviews.
    reworkRatePct: v.number(),
    totalCostCents30d: v.number(),
    agentCompleted30d: v.number(),
    humanCompleted30d: v.number(),
  }),
  handler: async (ctx, args) => {
    const { project } = await loadAccessibleProject(
      ctx,
      args.projectId,
      args.organizationId,
    );

    // Live counts: bounded walk of the project's non-archived tasks.
    const countsByStatus = {
      backlog: 0,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      cancelled: 0,
    };
    let counted = 0;
    let capped = false;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))) {
      if (task.archivedAt) continue;
      if (args.externalSystem && task.externalSystem !== args.externalSystem)
        continue;
      countsByStatus[task.status] += 1;
      counted += 1;
      if (counted >= TASK_BOARD_CAP) {
        capped = true;
        break;
      }
    }
    const openTotal =
      countsByStatus.backlog +
      countsByStatus.todo +
      countsByStatus.in_progress +
      countsByStatus.in_review;

    // Rollup windows: one scan from the 30d start key; the 7d window is a
    // subset split off in the same pass.
    const start30 = windowKeys(30).startKey;
    const start7 = windowKeys(7).startKey;
    let completed7d = 0;
    let completed30d = 0;
    let created30d = 0;
    let reviewsPassed = 0;
    let reviewsChangesRequested = 0;
    let totalCostCents30d = 0;
    let agentCompleted30d = 0;
    let humanCompleted30d = 0;
    for await (const row of ctx.db
      .query('taskMetricsDaily')
      .withIndex('by_org_project_date', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', project._id)
          .gte('dateKey', start30),
      )) {
      completed30d += row.tasksCompleted;
      created30d += row.tasksCreated;
      reviewsPassed += row.reviewsPassed;
      reviewsChangesRequested += row.reviewsChangesRequested;
      totalCostCents30d += row.totalCostCents;
      agentCompleted30d += row.agentCompleted;
      humanCompleted30d += row.humanCompleted;
      if (row.dateKey >= start7) completed7d += row.tasksCompleted;
    }

    const reviewsTotal = reviewsPassed + reviewsChangesRequested;
    const reworkRatePct =
      reviewsTotal === 0
        ? 0
        : Math.round((reviewsChangesRequested / reviewsTotal) * 100);

    return {
      countsByStatus,
      capped,
      openTotal,
      completed7d,
      completed30d,
      created30d,
      reworkRatePct,
      totalCostCents30d,
      agentCompleted30d,
      humanCompleted30d,
    };
  },
});
