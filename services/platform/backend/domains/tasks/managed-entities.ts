import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  foldedLabels,
  MANAGED_TASK_INITIAL_STATUSES,
  managedProjectLabelSchema,
  managedTaskSchema,
  type ManagedObservation,
} from '@tale/shared/schemas/managed-configuration';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { TaskError } from './errors.ts';
import {
  assertTaskLabelsEditable,
  assertTaskReadable,
  assignTask,
  createTask,
  createTaskLabel,
  loadTaskOrThrow,
  renameTaskLabel,
  updateTask,
  type TaskRow,
  type UpdateTaskArgs,
} from './service.ts';

/**
 * Standing tasks and project labels as managed configuration declares them
 * (`task`, `project-label`): read in the shape a declaration states, and
 * created or brought in line through the writers the board uses, so their
 * roles, limits, activity rows and hints hold unchanged. A task's status is
 * the work's own: a declaration names only the column a task it creates
 * starts in, and never reads or moves it afterwards. Nothing absent from a
 * declaration is deleted.
 */

/** A label's row, matched as the catalog matches it: whatever the case. */
async function findLabel(
  sql: Sql | TransactionSql,
  projectId: string,
  name: string,
  lock = false,
): Promise<{ id: string; name: string } | null> {
  const rows = lock
    ? await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM app.task_labels
        WHERE project_id = ${projectId} AND lower(name) = lower(${name})
        LIMIT 1 FOR UPDATE
      `
    : await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM app.task_labels
        WHERE project_id = ${projectId} AND lower(name) = lower(${name})
        LIMIT 1
      `;
  return rows[0] ?? null;
}

/** A project's label as managed configuration reads it — named as the
 * catalog spells it — or `null` when the project has none by that name and
 * the declaration may create it. */
export async function readManagedProjectLabel(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  name: string,
  createIfMissing = false,
) {
  assertTaskReadable(await loadProjectOrThrow(sql, projectId), auth);
  const label = await findLabel(sql, projectId, name);
  if (label === null) {
    if (createIfMissing) return { config: null, hash: null };
    throw new TaskError('TASK_LABEL_UNKNOWN', 'Label not found', 404);
  }
  const config: ManagedObservation<'project-label'> = {
    projectId,
    name: label.name,
  };
  return { config, hash: managedConfigurationHash(config) };
}

export const managedProjectLabelWriteSchema = z.strictObject({
  config: managedProjectLabelSchema,
  expectedHash: expectedConfigurationHashSchema,
  createIfMissing: z.literal(true).optional(),
});

/** Create the declared label, or respell an existing one the way the
 * declaration spells it — whoever may edit the project's tasks, on an
 * active project. */
export async function writeManagedProjectLabel(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: z.infer<typeof managedProjectLabelWriteSchema>,
): Promise<void> {
  const config = managedProjectLabelSchema.parse(args.config);
  assertTaskLabelsEditable(
    await loadProjectOrThrow(tx, config.projectId),
    auth,
  );
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended(${`task-labels:${config.projectId}`}, 0))
  `;
  const label = await findLabel(tx, config.projectId, config.name, true);
  assertExpectedHash(
    label === null
      ? null
      : managedConfigurationHash({
          projectId: config.projectId,
          name: label.name,
        }),
    args.expectedHash,
  );
  if (label === null) {
    if (args.createIfMissing !== true)
      throw new TaskError('TASK_LABEL_UNKNOWN', 'Label not found', 404);
    await createTaskLabel(tx, auth, {
      projectId: config.projectId,
      name: config.name,
    });
    return;
  }
  if (label.name !== config.name)
    await renameTaskLabel(tx, auth, { labelId: label.id, name: config.name });
}

/** A task in the shape its declaration reads. Its labels read case-folded
 * (`foldedLabels`): a task wears a label by its name whatever its case, and
 * the spelling is the catalog's, which `project-label` declares. Its
 * assignee reads as the project agent it is assigned to, and `null`
 * otherwise — also while a person or an automation holds it, whom a
 * declaration leaves alone until it names an agent. */
async function managedTaskView(
  sql: Sql | TransactionSql,
  task: TaskRow,
): Promise<ManagedObservation<'task'>> {
  const labels =
    task.labelIds.length === 0
      ? []
      : await sql<{ name: string }[]>`
          SELECT name FROM app.task_labels
          WHERE project_id = ${task.projectId} AND id = ANY(${task.labelIds})
        `;
  return {
    projectId: task.projectId,
    taskId: task.id,
    title: task.title,
    labels: foldedLabels(labels.map((label) => label.name)),
    assigneeAgentId: task.assigneeType === 'agent' ? task.assigneeId : null,
    priority: task.priority,
  };
}

/** The task under the id in this organization; `null` only when no row in
 * any organization holds the id and the declaration may create it. */
async function taskOrAbsent(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
  createIfMissing: boolean,
): Promise<TaskRow | null> {
  const held = await sql<{ id: string }[]>`
    SELECT id FROM app.tasks WHERE id = ${taskId}
  `;
  if (held.length === 0 && createIfMissing) return null;
  return loadTaskOrThrow(sql, taskId, auth.organizationId);
}

/** A standing task as managed configuration reads it, or `null` with no
 * hash when none exists under the id and the declaration may create it. */
export async function readManagedTask(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  taskId: string,
  createIfMissing = false,
) {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  const task = await taskOrAbsent(sql, auth, taskId, createIfMissing);
  if (task === null) return { config: null, hash: null };
  if (task.projectId !== projectId)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  const config = await managedTaskView(sql, task);
  return { config, hash: managedConfigurationHash(config) };
}

export const managedTaskWriteSchema = z.strictObject({
  config: managedTaskSchema,
  expectedHash: expectedConfigurationHashSchema,
  createIfMissing: z.literal(true).optional(),
  initialStatus: z.enum(MANAGED_TASK_INITIAL_STATUSES).optional(),
  /** The description a created task starts with, which its declared
   * `task-instructions` names. */
  description: z.string().optional(),
});

/**
 * Create the declared task under its UUID in the column it starts in, or
 * bring an existing one's title, labels, priority and agent assignee in
 * line — through the board's own writers: who may work the task, on an
 * active project, never an archived task, labels from the project's
 * catalog, an agent of this project, and no reassignment while a run holds
 * the task. Compare-and-set on the hash the plan read.
 */
export async function writeManagedTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: z.infer<typeof managedTaskWriteSchema>,
): Promise<void> {
  const config = managedTaskSchema.parse(args.config);
  await tx`SELECT id FROM app.tasks WHERE id = ${config.taskId} FOR UPDATE`;
  const task = await taskOrAbsent(
    tx,
    auth,
    config.taskId,
    args.createIfMissing === true,
  );
  if (task !== null && task.projectId !== config.projectId)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  assertExpectedHash(
    task === null
      ? null
      : managedConfigurationHash(await managedTaskView(tx, task)),
    args.expectedHash,
  );
  if (task === null) {
    try {
      await createTask(
        tx,
        auth,
        {
          projectId: config.projectId,
          title: config.title,
          status: args.initialStatus ?? 'backlog',
          ...(config.priority != null ? { priority: config.priority } : {}),
          ...(config.labels !== undefined && config.labels.length > 0
            ? { labels: config.labels }
            : {}),
          ...(config.assigneeAgentId != null
            ? { assigneeType: 'agent', assigneeId: config.assigneeAgentId }
            : {}),
          ...(args.description !== undefined && args.description.length > 0
            ? { description: args.description }
            : {}),
        },
        { taskId: config.taskId },
      );
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      )
        throw new TaskError(
          'TASK_ID_TAKEN',
          'The declared task identity is unavailable',
          409,
        );
      throw error;
    }
    return;
  }
  const current = await managedTaskView(tx, task);
  const patch: UpdateTaskArgs = { taskId: task.id };
  if (config.title !== current.title) patch.title = config.title;
  if (config.priority !== undefined && config.priority !== current.priority)
    patch.priority = config.priority;
  if (
    config.labels !== undefined &&
    config.labels.join('\u0000') !== current.labels.join('\u0000')
  )
    patch.labels = config.labels;
  if (Object.keys(patch).length > 1) await updateTask(tx, auth, patch);
  if (
    config.assigneeAgentId !== undefined &&
    config.assigneeAgentId !== current.assigneeAgentId
  )
    await assignTask(
      tx,
      auth,
      config.assigneeAgentId === null
        ? { taskId: task.id }
        : {
            taskId: task.id,
            assigneeType: 'agent',
            assigneeId: config.assigneeAgentId,
          },
    );
}
