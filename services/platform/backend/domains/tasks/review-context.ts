import {
  managedTaskReviewContextSchema,
  managedTaskReviewContextProvisionSchema,
  type ManagedTaskReviewContext,
} from '@tale/shared/schemas/managed-configuration';
import type { Sql, TransactionSql } from 'postgres';

import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { TaskError } from './errors.ts';
import { agentReviewerEligibility } from './reviews.ts';
import { lockAgentForStart, lockTaskRunStart } from './run-start.ts';
import {
  assertTaskNotArchived,
  assertTaskReadable,
  assertTaskWorkable,
  createTask,
  loadTaskOrThrow,
  type TaskRow,
} from './service.ts';

export async function readReviewContext(
  sql: Sql | TransactionSql,
  organizationId: string,
  taskId: string,
): Promise<ManagedTaskReviewContext | null> {
  const rows = await sql<ManagedTaskReviewContext[]>`
    SELECT project_id AS "projectId", task_id AS "taskId",
      reviewer_agent_id AS "reviewerAgentId", enabled
    FROM app.task_review_contexts
    WHERE org_id = ${organizationId} AND task_id = ${taskId}
  `;
  return rows[0] ?? null;
}

export async function readTaskReviewContextConfiguration(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  taskId: string,
  createIfMissing = false,
) {
  assertTaskReadable(await loadProjectOrThrow(sql, projectId), auth);
  const task = await taskForContext(
    sql,
    auth.organizationId,
    taskId,
    createIfMissing,
  );
  if (task === null) return { config: null, hash: null };
  if (task.projectId !== projectId)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  const config = await readReviewContext(sql, auth.organizationId, taskId);
  return { config, hash: managedConfigurationHash(config) };
}

async function taskForContext(
  sql: Sql | TransactionSql,
  organizationId: string,
  taskId: string,
  allowMissing: boolean,
): Promise<TaskRow | null> {
  try {
    return await loadTaskOrThrow(sql, taskId, organizationId);
  } catch (error) {
    if (
      allowMissing &&
      error instanceof TaskError &&
      error.code === 'TASK_NOT_FOUND'
    )
      return null;
    throw error;
  }
}

function isEmptyList(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

/** Actual native history, never the legacy denormalized run counter. The
 * caller holds the task's UPDATE fence, which both engines use on start. */
async function assertPristineReviewContext(
  tx: TransactionSql,
  task: TaskRow,
  reviewerAgentId: string,
) {
  if (
    !['backlog', 'todo'].includes(task.status) ||
    task.externalSystem !== null ||
    task.externalId !== null ||
    task.externalUrl !== null ||
    task.parentTaskId !== null ||
    task.repeat !== null ||
    task.repeatContinued ||
    task.repeatNextTaskId !== null ||
    task.completedAt !== null ||
    !isEmptyList(task.attachments) ||
    !isEmptyList(task.outputs) ||
    task.threadId !== null ||
    task.sourceDiscussionThreadId !== null ||
    !(
      (task.assigneeId === null && task.assigneeType === null) ||
      (task.assigneeType === 'agent' && task.assigneeId === reviewerAgentId)
    )
  ) {
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'Enroll a new native operational task without source work or deliverables',
      409,
    );
  }
  const history = await tx<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM app.project_agent_runs
      WHERE org_id = ${task.organizationId} AND task_id = ${task.id}
      UNION ALL
      SELECT 1 FROM app.approvals
      WHERE org_id = ${task.organizationId} AND resource_type = 'task_review'
        AND resource_id = ${task.id}
      UNION ALL
      SELECT 1 FROM app.automation_runs
      WHERE org_id = ${task.organizationId} AND input -> 'task' ->> 'id' = ${task.id}
      UNION ALL
      SELECT 1 FROM app.tasks WHERE org_id = ${task.organizationId} AND parent_task_id = ${task.id}
      UNION ALL
      SELECT 1 FROM app.tasks WHERE org_id = ${task.organizationId} AND id = ${task.id}
        AND (source_thread_id IS NOT NULL OR review_context = true)
      UNION ALL
      SELECT 1 FROM app.task_activity
      WHERE org_id = ${task.organizationId} AND task_id = ${task.id}
        AND (action = 'review.responded' OR (action = 'status.changed'
          AND to_value IN ('in_progress', 'in_review', 'done', 'cancelled')))
      UNION ALL
      SELECT 1 FROM app.task_dependencies
      WHERE blocker_task_id = ${task.id} OR blocked_task_id = ${task.id}
    ) AS present
  `;
  if (history[0]?.present ?? true)
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'A task with execution, review or child-task history cannot become a review context',
      409,
    );
}

/** Managed native enrollment; no agent tool or generic task patch accepts
 * this purpose. Agent-before-task lock order is shared with delegated starts.
 * The binding remains immutable while disabled and after all runs expire. */
export async function updateTaskReviewContextConfiguration(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  raw: ManagedTaskReviewContext,
  expectedHash: string | null,
  createIfMissing = false,
): Promise<void> {
  const config = managedTaskReviewContextSchema.parse(raw);
  managedTaskReviewContextProvisionSchema.parse({
    config,
    ...(createIfMissing ? { createIfMissing: true } : {}),
  });
  const initial = await taskForContext(
    tx,
    auth.organizationId,
    config.taskId,
    createIfMissing,
  );
  if (initial !== null && initial.projectId !== config.projectId)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  const project = await loadProjectOrThrow(tx, config.projectId);
  assertTaskReadable(project, auth);
  if (!checkProjectAccess(project, auth.teamIds, auth.role).canEdit)
    throw new TaskError('RBAC_FORBIDDEN', 'Editor role required', 403);
  await lockAgentForStart(tx, {
    organizationId: auth.organizationId,
    projectId: config.projectId,
    agentId: config.reviewerAgentId,
  });
  await lockTaskRunStart(tx, auth.organizationId, config.taskId);
  let task = await taskForContext(
    tx,
    auth.organizationId,
    config.taskId,
    createIfMissing,
  );
  if (task === null) {
    assertExpectedHash(null, expectedHash);
    try {
      await createTask(
        tx,
        auth,
        {
          projectId: config.projectId,
          title: 'Independent review context',
          status: 'backlog',
          assigneeType: 'agent',
          assigneeId: config.reviewerAgentId,
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
          'TASK_REVIEW_INVALID',
          'The declared task identity is unavailable',
          409,
        );
      throw error;
    }
    task = await loadTaskOrThrow(tx, config.taskId, auth.organizationId);
  }
  if (task.projectId !== config.projectId)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  await assertTaskWorkable(tx, project, task, auth);
  assertTaskNotArchived(task);
  const prior = await readReviewContext(tx, auth.organizationId, task.id);
  assertExpectedHash(managedConfigurationHash(prior), expectedHash);
  if (prior !== null && prior.reviewerAgentId !== config.reviewerAgentId)
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'A managed review context cannot change its reviewer identity',
      409,
    );
  if (prior === null)
    await assertPristineReviewContext(tx, task, config.reviewerAgentId);
  if (
    (prior === null || config.enabled) &&
    (await agentReviewerEligibility(tx, {
      organizationId: auth.organizationId,
      projectId: config.projectId,
      agentId: config.reviewerAgentId,
    })) !== 'eligible'
  )
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'The context needs an available project reviewer with task_review',
      403,
    );
  if (prior?.enabled === config.enabled) return;
  if (prior === null)
    await tx`UPDATE app.tasks SET review_context = true
      WHERE id = ${task.id} AND org_id = ${auth.organizationId}`;
  await tx`
    INSERT INTO app.task_review_contexts
      (task_id, org_id, project_id, reviewer_agent_id, enabled, created_at_ms, updated_at_ms)
    VALUES (${task.id}, ${auth.organizationId}, ${config.projectId},
      ${config.reviewerAgentId}, ${config.enabled}, ${Date.now()}, ${Date.now()})
    ON CONFLICT (task_id) DO UPDATE SET enabled = EXCLUDED.enabled,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    actorType: 'user',
    action: 'task.review_context_configured',
    category: 'data',
    resourceType: 'task',
    resourceId: task.id,
    resourceName: task.title,
    ...(prior !== null ? { previousState: prior } : {}),
    newState: config,
    status: 'success',
  });
}
