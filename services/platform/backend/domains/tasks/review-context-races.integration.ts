/** The existing native review lane owns every synthetic row. This proves
 * discriminator FKs with real PostgreSQL lock witnesses, without agent jobs,
 * external effects or a second execution/admission engine. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { Sql, TransactionSql } from 'postgres';

import type { ProjectAuthContext } from '../projects/service.ts';
import type { Fixtures, Recorder } from './delegated-start.integration.ts';
import { updateTaskReviewContextConfiguration } from './review-context.ts';

function codeOf(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : String(error);
}

export async function checkReviewContextRaces(args: {
  sql: Sql;
  orgId: string;
  projectId: string;
  reviewerAgentId: string;
  auth: ProjectAuthContext;
  fx: Fixtures;
  record: Recorder;
}): Promise<void> {
  const { sql, orgId, projectId, reviewerAgentId, auth, fx, record } = args;
  const ownedContexts: string[] = [];
  const pidOf = async (tx: TransactionSql) => {
    await tx`SELECT set_config('statement_timeout', '8000', true),
      set_config('lock_timeout', '6000', true)`;
    const rows = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    if (rows[0] === undefined)
      throw new Error('Review context fixture has no backend PID');
    return rows[0].pid;
  };
  const blockedBy = async (waiter: () => number, holder: () => number) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (waiter() !== 0 && holder() !== 0) {
        const rows = await sql<
          { blockers: number[] }[]
        >`SELECT pg_blocking_pids(${waiter()}) AS blockers`;
        if (rows[0]?.blockers.includes(holder())) return true;
      }
      await delay(10);
    }
    return false;
  };
  try {
    for (const kind of ['child', 'blocker', 'blocked'] as const) {
      for (const isolation of ['read committed', 'serializable'] as const) {
        for (const enrollmentFirst of [false, true]) {
          const parent = await fx.insertTask({
            projectId,
            title: 'Enrollment race parent',
          });
          const sibling = await fx.insertTask({
            projectId,
            title: 'Ordinary endpoint',
          });
          const child = randomUUID();
          ownedContexts.push(parent);
          const config = {
            projectId,
            taskId: parent,
            reviewerAgentId,
            enabled: true,
          };
          const oldWrite = async (tx: TransactionSql) => {
            if (kind === 'child') {
              await tx`INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
                parent_task_id, created_by, created_by_type, created_at_ms, updated_at_ms)
                VALUES (${child}, ${orgId}, ${projectId}, 'Old writer child', 'todo', 'a0',
                  ${parent}, ${auth.userId}, 'user', ${fx.now}, ${fx.now})`;
            } else {
              await tx`INSERT INTO app.task_dependencies (org_id, project_id,
                blocker_task_id, blocked_task_id, created_by, created_by_type, created_at_ms)
                VALUES (${orgId}, ${projectId}, ${kind === 'blocker' ? parent : sibling},
                  ${kind === 'blocked' ? parent : sibling}, ${auth.userId}, 'user', ${fx.now})`;
            }
          };
          const ready = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          let holder = 0;
          let waiter = 0;
          let firstCode: string | null = null;
          const first = sql
            .begin(
              enrollmentFirst
                ? 'isolation level serializable'
                : `isolation level ${isolation}`,
              async (tx) => {
                holder = await pidOf(tx);
                if (enrollmentFirst)
                  await updateTaskReviewContextConfiguration(
                    tx,
                    auth,
                    config,
                    null,
                  );
                else await oldWrite(tx);
                ready.resolve();
                await release.promise;
              },
            )
            .then(
              () => null,
              (error: unknown) => {
                firstCode = codeOf(error);
                return firstCode;
              },
            );
          // Failure also releases readiness, so teardown never waits for a
          // barrier that a failed statement cannot reach.
          void first.finally(() => ready.resolve());
          await ready.promise;
          const second = sql
            .begin(
              enrollmentFirst
                ? `isolation level ${isolation}`
                : 'isolation level serializable',
              async (tx) => {
                waiter = await pidOf(tx);
                // Establish the enrollment snapshot before waiting for the old
                // writer, reproducing the stale-pristine-query counterexample.
                await tx`SELECT id FROM app.tasks WHERE id = ${parent}`;
                if (enrollmentFirst) await oldWrite(tx);
                else
                  await updateTaskReviewContextConfiguration(
                    tx,
                    auth,
                    config,
                    null,
                  );
              },
            )
            .then(
              () => null,
              (error: unknown) => codeOf(error),
            );
          let witnessed = false;
          let witnessError: unknown;
          try {
            witnessed =
              firstCode === null &&
              (await blockedBy(
                () => waiter,
                () => holder,
              ));
          } catch (error) {
            witnessError = error;
          } finally {
            release.resolve();
          }
          const [firstResult, secondResult] = await Promise.all([
            first,
            second,
          ]);
          if (witnessError !== undefined) throw witnessError;
          const rows = await sql<{ context: boolean; links: number }[]>`
            SELECT t.review_context AS context,
              ((SELECT count(*) FROM app.tasks WHERE parent_task_id = t.id) +
               (SELECT count(*) FROM app.task_dependencies WHERE blocker_task_id = t.id OR blocked_task_id = t.id))::int AS links
            FROM app.tasks t WHERE t.id = ${parent}`;
          const state = rows[0];
          record(
            `review context race: ${kind}, ${isolation}, ${enrollmentFirst ? 'enrollment' : 'old writer'} first`,
            witnessed &&
              firstResult === null &&
              ['23503', '40001'].includes(secondResult ?? '') &&
              state?.context === enrollmentFirst &&
              state.links === (enrollmentFirst ? 0 : 1),
            JSON.stringify({ witnessed, firstResult, secondResult, state }),
          );
        }
      }
    }
    const parent = await fx.insertTask({
      projectId,
      title: 'Ordinary deletion parent',
    });
    const child = await fx.insertTask({
      projectId,
      title: 'Ordinary deletion child',
    });
    const other = await fx.insertTask({
      projectId,
      title: 'Ordinary dependency endpoint',
    });
    await sql`UPDATE app.tasks SET parent_task_id = ${parent} WHERE id = ${child}`;
    await fx.block(other, parent, projectId);
    await sql`DELETE FROM app.tasks WHERE id = ${parent}`;
    const remaining = await sql<{ parent: string | null; edges: number }[]>`
      SELECT parent_task_id AS parent, (SELECT count(*)::int FROM app.task_dependencies
        WHERE blocker_task_id = ${parent} OR blocked_task_id = ${parent}) AS edges
      FROM app.tasks WHERE id = ${child}`;
    record(
      'review context: ordinary parent null and dependency cascade deletion remain compatible',
      remaining[0]?.parent === null && remaining[0].edges === 0,
      JSON.stringify(remaining),
    );
  } finally {
    // The parent lane owns all tasks; remove only these inert opted-in
    // sidecars so its ordinary project teardown can reclaim the fixtures.
    if (ownedContexts.length > 0)
      await sql`DELETE FROM app.task_review_contexts WHERE org_id = ${orgId}
        AND project_id = ${projectId} AND task_id = ANY(${ownedContexts})`;
  }
}
