import type { Sql, TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * Asking for a pass of a project's dispatch (`dispatch-pass.ts`). Kept apart
 * from the dispatch's other modules so the places a run ends, or a model
 * answers again, can ask without importing the dispatch itself.
 */

/** What asked for a dispatch pass. */
export const DISPATCH_PASS_TRIGGERS = [
  'scan',
  'run_ended',
  'capacity_cleared',
  'config',
  'recheck',
  'manual',
  'gate',
] as const;

export type DispatchPassTrigger = (typeof DISPATCH_PASS_TRIGGERS)[number];

/**
 * Ask for a pass of the project's dispatch, in the caller's transaction:
 * at most one pass waits per project (a second request while one waits is
 * the same pass), so a burst of ended runs asks once.
 */
export async function requestDispatchPassInTx(
  tx: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    trigger: DispatchPassTrigger;
    startAfterMs?: number;
  },
): Promise<void> {
  await addJobInTx(
    tx,
    'tasks.dispatch_project',
    {
      organizationId: args.organizationId,
      projectId: args.projectId,
      trigger: args.trigger,
    },
    {
      singletonKey: `dispatch:${args.projectId}`,
      ...(args.startAfterMs !== undefined && args.startAfterMs > Date.now()
        ? { startAfter: new Date(args.startAfterMs) }
        : {}),
    },
  );
}

/** Ask for a pass of each named project's dispatch that is switched on —
 * the run that ended freed room in its pool: the task's project's, and its
 * agent's own project's when the agent worked another board. In the
 * transaction that ended the run. */
export async function requestDispatchPassForRunInTx(
  tx: TransactionSql,
  run: { organizationId: string; projectIds: readonly string[] },
): Promise<void> {
  const enabled = await tx<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.project_dispatch
    WHERE project_id = ANY(${[...run.projectIds]})
      AND org_id = ${run.organizationId} AND enabled = true
    ORDER BY project_id
  `;
  for (const { projectId } of enabled) {
    await requestDispatchPassInTx(tx, {
      organizationId: run.organizationId,
      projectId,
      trigger: 'run_ended',
    });
  }
}

/** Ask for a pass of every switched-on dispatch of the organization — a
 * model its pools wait on answers again. */
export async function requestOrganizationDispatchPassesInTx(
  tx: TransactionSql,
  args: { organizationId: string; trigger: DispatchPassTrigger },
): Promise<void> {
  const projects = await tx<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.project_dispatch
    WHERE org_id = ${args.organizationId} AND enabled = true
    LIMIT 500
  `;
  for (const { projectId } of projects) {
    await requestDispatchPassInTx(tx, {
      organizationId: args.organizationId,
      projectId,
      trigger: args.trigger,
    });
  }
}
