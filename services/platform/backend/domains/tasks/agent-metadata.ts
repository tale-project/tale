import type { TransactionSql } from 'postgres';

import { taskMetadataPatchSchema } from '../../core/tasks/metadata.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { TaskError } from './errors.ts';
import { getPendingReviewForTask } from './reviews.ts';
import { lockTaskRunStart } from './run-start.ts';
import {
  agentAssignTaskToAgentTrusted,
  agentUpdateTaskPriorityTrusted,
  assigneeChanges,
  assertAssigneeValid,
  assertTaskCreatable,
  assertTaskNotArchived,
  loadTaskOrThrow,
  type TaskRow,
} from './service.ts';

function assertTarget(task: TaskRow, projectId: string): void {
  if (task.projectId !== projectId) {
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  }
  assertTaskNotArchived(task);
}

/** The session shim rechecks the live issuer's project authority in this
 * transaction. Only priority and project-agent ownership enter this door;
 * protected workflow/review fields never become mutation arguments. */
export async function updateAgentTaskMetadata(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    actorId: string;
    patch: unknown;
  },
) {
  const parsed = taskMetadataPatchSchema.safeParse(args.patch);
  if (!parsed.success) {
    throw new TaskError(
      'TASK_METADATA_INVALID',
      'Name the task, each metadata change and its expected current value; no other fields are accepted',
    );
  }
  const patch = parsed.data;
  const initial = await loadTaskOrThrow(tx, patch.taskId, args.organizationId);
  assertTarget(initial, args.projectId);
  const project = await loadProjectOrThrow(tx, initial.projectId);
  assertTaskCreatable(project, {
    organizationId: args.organizationId,
    userId: args.actorId,
    role: 'admin',
    teamIds: [],
  });
  // Authorize before any write, even the lock's no-field-change UPDATE.
  // Same contention point as both engines; no agent lock follows it. A
  // conflicting task change invalidates this SERIALIZABLE snapshot on retry.
  await lockTaskRunStart(tx, args.organizationId, patch.taskId);
  const task = await loadTaskOrThrow(tx, patch.taskId, args.organizationId);
  assertTarget(task, args.projectId);

  const expectedAssignee = patch.expected.assignee;
  if (
    (patch.priority !== undefined &&
      patch.expected.priority !== task.priority) ||
    (patch.agentId !== undefined &&
      (task.assigneeType !== (expectedAssignee?.type ?? null) ||
        task.assigneeId !== (expectedAssignee?.id ?? null)))
  ) {
    throw new TaskError(
      'TASK_METADATA_STALE',
      'Task metadata changed since it was read; read it again before deciding',
      409,
    );
  }
  const assignee =
    patch.agentId == null
      ? null
      : { assigneeType: 'agent' as const, assigneeId: patch.agentId };
  const ownershipChanged =
    patch.agentId !== undefined && assigneeChanges(task, assignee);
  const priorityChanged =
    patch.priority !== undefined && patch.priority !== task.priority;
  if (ownershipChanged) {
    if (
      !['backlog', 'todo', 'in_progress'].includes(task.status) ||
      (await getPendingReviewForTask(tx, args.organizationId, task.id)) !== null
    ) {
      throw new TaskError(
        'TASK_METADATA_OWNER_PROTECTED',
        'The task is closed or awaiting review; preserve its current owner',
        409,
      );
    }
    await assertAssigneeValid(tx, {
      project,
      auth: { organizationId: args.organizationId, userId: args.actorId },
      assignee,
    });
    // The shared assignment writer refuses live agent AND automation runs,
    // including a target held by the same agent that issued this request.
    await agentAssignTaskToAgentTrusted(tx, {
      task,
      agentId: patch.agentId ?? null,
      actorId: args.actorId,
    });
  }
  if (priorityChanged && patch.priority !== undefined) {
    await agentUpdateTaskPriorityTrusted(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      taskId: task.id,
      priority: patch.priority,
    });
  }
  const stored = await loadTaskOrThrow(tx, task.id, args.organizationId);
  return {
    taskId: stored.id,
    priority: stored.priority,
    assigneeType: stored.assigneeType,
    assigneeId: stored.assigneeId,
    changed: ownershipChanged || priorityChanged,
  };
}
