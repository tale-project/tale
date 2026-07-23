/**
 * Issue Desk overview KPIs for one project (the `StatGrid` query).
 *
 * `countsByStatus` is a LIVE walk of the project's tasks (`by_project`,
 * archived rows skipped, optionally scoped to `externalSystem`), bounded by
 * {@link TASK_BOARD_CAP} with a `capped` flag — mirroring
 * `listTasksByProject`'s bounded-scan semantics.
 *
 * The windowed sums (`completed7d`/`completed30d`/`created30d`/
 * `reworkRatePct`/`totalCostCents30d`/`agentCompleted30d`/
 * `humanCompleted30d`) were re-aggregated from the `taskMetricsDaily`
 * rollups; the 0.4 baseline reset dropped that table and no replacement
 * rollup exists yet, so they are constant zeros — the honest fresh-deploy
 * state. The return shape is kept stable so callers keep compiling; a
 * rebuilt rollup repopulates these fields without an API change (its pure
 * window math survives in `date_keys.ts`).
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
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
    // (e.g. 'github'), mirroring `listTasksByProject`.
    externalSystem: v.optional(v.string()),
  },
  returns: v.object({
    countsByStatus: statusCountsValidator,
    // True when the live status walk hit TASK_BOARD_CAP — counts are lower
    // bounds.
    capped: v.boolean(),
    openTotal: v.number(),
    // Rollup-window fields: constant 0 until a rollup rebuild lands — see
    // the module doc comment.
    completed7d: v.number(),
    completed30d: v.number(),
    created30d: v.number(),
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

    return {
      countsByStatus,
      capped,
      openTotal,
      completed7d: 0,
      completed30d: 0,
      created30d: 0,
      reworkRatePct: 0,
      totalCostCents30d: 0,
      agentCompleted30d: 0,
      humanCompleted30d: 0,
    };
  },
});
