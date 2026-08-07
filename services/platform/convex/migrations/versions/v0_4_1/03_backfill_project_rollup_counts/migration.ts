/**
 * Backfill the denormalized project rollup counters.
 *
 * The projects list renders each project's task progress and agent count from
 * `projects.openTaskCount` / `doneTaskCount` / `projectAgentCount`, which the
 * task and project-agent mutations maintain incrementally from this release
 * on. Projects that already existed carry none of those fields, so the row
 * would read `0/0` for every one of them until something happened to touch it.
 *
 * `up` recomputes all three from the live rows: it walks the project's tasks
 * (bucketing each as open / done / neither) and its `projectAgents` rows, then
 * patches the project when a stored value differs. Idempotent — a project
 * whose counters already agree is a no-op, and a project with nothing gets an
 * explicit `0, 0, 0` rather than being left undefined, matching what
 * `createProject` writes for new rows.
 *
 * `down` clears all three fields back to `undefined`, restoring the pre-release
 * shape exactly. Nothing is destroyed in either direction — the counters are a
 * pure projection of `tasks` and `projectAgents`, which is why
 * `snapshot: 'none'` is sufficient: `up` is fully reconstructible from data
 * that is never mutated here.
 *
 * Deliberately NOT backfilled: an overdue count. Overdue is time-derived, so
 * it could never satisfy the up→down→re-up digest equality this framework
 * enforces; the list query derives it per read instead.
 */

import type { GenericId } from 'convex/values';

import { defineDbMigration } from '../../../framework/define';

/**
 * Local copy of `taskCountBucket` — migrations must not import app lib, so
 * that a migration frozen at this release keeps behaving the same however the
 * app's bucket rules evolve later. `tasks/project_task_counts.test.ts` pins
 * the app-side function to the same truth table.
 */
function bucketOf(
  status: unknown,
  archivedAt: unknown,
): 'open' | 'done' | 'none' {
  if (typeof archivedAt === 'number') return 'none';
  if (status === 'done') return 'done';
  if (status === 'cancelled') return 'none';
  return 'open';
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export const migration = defineDbMigration({
  title: 'Backfill project rollup counts',
  description:
    'Recomputes projects.openTaskCount and doneTaskCount from every non-archived task in the project (cancelled counted in neither) and projectAgentCount from its projectAgents rows; down clears all three fields.',
  destructive: false,
  snapshot: 'none',
  // Every table the handlers read or write — the corpus guard checks the
  // chain world can exercise each one.
  subjects: { tables: ['projects', 'tasks', 'projectAgents'] },
  table: 'projects',
  // Each row fans out over its whole `tasks.by_project` index inside the batch
  // transaction, so keep batches small enough that batchSize x tasks-per-project
  // stays well under the per-transaction document ceiling.
  batchSize: 10,

  async up(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runner paginates `table: 'projects'`, so every doc is a project row
    const projectId = doc._id as GenericId<'projects'>;

    let open = 0;
    let done = 0;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))) {
      const bucket = bucketOf(task.status, task.archivedAt);
      if (bucket === 'open') open += 1;
      else if (bucket === 'done') done += 1;
    }

    let agents = 0;
    for await (const _agent of ctx.db
      .query('projectAgents')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))) {
      agents += 1;
    }

    // Skip the write when the row already agrees — replaying a crashed batch
    // must not churn documents.
    if (
      num(doc.openTaskCount) === open &&
      num(doc.doneTaskCount) === done &&
      num(doc.projectAgentCount) === agents
    ) {
      return;
    }

    await ctx.db.patch(projectId, {
      openTaskCount: open,
      doneTaskCount: done,
      projectAgentCount: agents,
    });
  },

  async down(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
    const projectId = doc._id as GenericId<'projects'>;
    if (
      doc.openTaskCount === undefined &&
      doc.doneTaskCount === undefined &&
      doc.projectAgentCount === undefined
    ) {
      return;
    }
    await ctx.db.patch(projectId, {
      openTaskCount: undefined,
      doneTaskCount: undefined,
      projectAgentCount: undefined,
    });
  },
});
