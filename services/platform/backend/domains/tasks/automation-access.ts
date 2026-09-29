import { parseTaskSubjectContract } from '@tale/shared/schemas/task-contract';
import type { Sql, TransactionSql } from 'postgres';

import { checkProjectAccess } from '../../core/projects/access.ts';
import { deployedVersion, versionRow } from '../automations/store.ts';
import type { ProjectAuthContext, ProjectRow } from '../projects/service.ts';
import { TaskError } from './errors.ts';
import type { TaskRow } from './service.ts';

/**
 * Which automations a person may put to work on a task.
 *
 * An automation runs as itself: its connectors act with the organization's
 * credentials and skip the approvals a person's own calls wait for, and an
 * automation without project bindings may run in any project. Naming one on
 * a task is therefore project administration unless the automation was
 * built to take tasks. A project's editors may start, assign and hand a
 * task to any automation; everyone else — the members who may work their
 * own tasks — only to an automation that declares a task contract (it
 * ships the task surface: Start, the input folder, Request changes) or to
 * the automation that already owns the task.
 */

/** The task contract of the automation's DEPLOYED version, or null when it
 * declares none (or nothing is deployed). */
async function deployedTaskContract(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<ReturnType<typeof parseTaskSubjectContract>> {
  const version = await deployedVersion(sql, organizationId, name);
  if (version === undefined) return null;
  const row = await versionRow(sql, organizationId, name, version);
  return row === null ? null : parseTaskSubjectContract(row.taskContract);
}

/** Whether the automation's deployed version declares a task contract —
 * it was built to be started on a task. */
export async function automationTakesTasks(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<boolean> {
  return (await deployedTaskContract(sql, organizationId, name)) !== null;
}

/**
 * Does this automation OWN the task? Three ownership shapes, in the 0.4
 * order: an app-assigned task names its automation directly, an
 * app-created one names its creator, and an externally-mirrored one matches
 * through its deployed version's task contract. A task with a human or agent
 * assignee is owned by nobody on this lane.
 */
export async function taskOwnedByAutomation(
  sql: Sql | TransactionSql,
  task: Pick<
    TaskRow,
    | 'organizationId'
    | 'assigneeType'
    | 'assigneeId'
    | 'createdByType'
    | 'createdBy'
    | 'externalSystem'
  >,
  name: string,
): Promise<boolean> {
  if (task.assigneeType === 'app') return task.assigneeId === name;
  if (task.assigneeType !== null) return false;
  if (task.createdByType === 'app') return task.createdBy === name;
  if (task.externalSystem == null || task.externalSystem === '') return false;
  const contract = await deployedTaskContract(sql, task.organizationId, name);
  return contract !== null && contract.externalSystem === task.externalSystem;
}

/**
 * Whether the caller may start the automation on the task, assign the task
 * to it, or create a task for it (`task` null: the task does not exist yet).
 */
export async function mayPutAutomationOnTask(
  sql: Sql | TransactionSql,
  args: {
    project: ProjectRow;
    auth: ProjectAuthContext;
    task: Parameters<typeof taskOwnedByAutomation>[1] | null;
    automation: string;
  },
): Promise<boolean> {
  const editor = checkProjectAccess(
    {
      teamId: args.project.teamId,
      sharedWithTeamIds: args.project.sharedWithTeamIds,
    },
    args.auth.teamIds,
    args.auth.role,
  ).canEdit;
  if (editor) return true;
  if (
    args.task !== null &&
    (await taskOwnedByAutomation(sql, args.task, args.automation))
  ) {
    return true;
  }
  return automationTakesTasks(sql, args.auth.organizationId, args.automation);
}

/** {@link mayPutAutomationOnTask} as a door's refusal (403 `RBAC_FORBIDDEN`). */
export async function assertAutomationForTask(
  sql: Sql | TransactionSql,
  args: Parameters<typeof mayPutAutomationOnTask>[1],
): Promise<void> {
  if (!(await mayPutAutomationOnTask(sql, args))) {
    throw new TaskError(
      'RBAC_FORBIDDEN',
      'Only an editor may put an automation that is not built for tasks to work on one',
      403,
    );
  }
}
