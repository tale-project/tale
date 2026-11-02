import type { TransactionSql } from 'postgres';

import {
  taskLabelsPatchSchema,
  taskMetadataPatchSchema,
} from '../../core/tasks/metadata.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { readAgentTaskLabels } from './agent-labels.ts';
import { authorityReaches } from './dispatch-reach.ts';
import { TaskError } from './errors.ts';
import { getPendingReviewForTask } from './reviews.ts';
import { lockTaskRunStart } from './run-start.ts';
import {
  agentAssignTaskToAgentTrusted,
  agentUpdateTaskLabelsTrusted,
  agentUpdateTaskPriorityTrusted,
  assigneeChanges,
  assertAssigneeValid,
  assertTaskCreatable,
  assertTaskNotArchived,
  loadTaskOrThrow,
  type TaskRow,
} from './service.ts';

function assertTarget(
  task: TaskRow,
  authority: { projectId: string; reachedProjectIds?: readonly string[] },
): void {
  if (!authorityReaches(authority, task.projectId)) {
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
    /** The acting agent's own project. */
    projectId: string;
    /** The other boards its project's dispatch puts it to work on now. */
    reachedProjectIds?: readonly string[];
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
  assertTarget(initial, args);
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
  assertTarget(task, args);

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

/** A label's key: its project's catalog holds one label per name without
 * regard to case, as `resolveProjectLabels` matches it. */
const labelKey = (name: string): string =>
  name.normalize('NFC').trim().toLowerCase();

function sameLabels(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map(labelKey));
  const right = new Set(b.map(labelKey));
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/**
 * `task_set_labels`: an agent adds and removes the labels its own grant names
 * on a task its run reaches. Its grant is read live here, so an admin who
 * unticks the tool or a label stops the next call; a label the grant does
 * not name is refused, and so is one the task's project does not have — the
 * tool never creates a label. It answers to the whole label list the agent
 * read, as `task_update_metadata` answers to the values it read
 * (`TASK_METADATA_STALE`). The change goes through the task edit writer under
 * the agent's name: `assertTaskWorkable`, a `labels.changed` row naming the
 * agent and an audit row marked `viaAgent`. Refusals carry no label name;
 * the names ride in `data`.
 */
export async function setAgentTaskLabels(
  tx: TransactionSql,
  args: {
    organizationId: string;
    /** The acting agent's own project, whose agent row holds its grant. */
    projectId: string;
    /** The other boards its project's dispatch puts it to work on now. */
    reachedProjectIds?: readonly string[];
    actorId: string;
    patch: unknown;
  },
): Promise<{ taskId: string; labels: string[]; changed: boolean }> {
  const parsed = taskLabelsPatchSchema.safeParse(args.patch);
  if (!parsed.success) {
    throw new TaskError(
      'TASK_LABELS_INVALID',
      'Name the task, the labels to add or remove and every label it wears now; no other fields are accepted',
    );
  }
  const patch = parsed.data;
  const initial = await loadTaskOrThrow(tx, patch.taskId, args.organizationId);
  assertTarget(initial, args);
  const project = await loadProjectOrThrow(tx, initial.projectId);
  assertTaskCreatable(project, {
    organizationId: args.organizationId,
    userId: args.actorId,
    role: 'admin',
    teamIds: [],
  });
  const [agent] = await tx<{ tools: string[]; labelGrants: string[] }[]>`
    SELECT tools, label_grants AS "labelGrants" FROM app.project_agents
    WHERE org_id = ${args.organizationId} AND id = ${args.actorId}
      AND project_id = ${args.projectId}
  `;
  if (agent === undefined || !agent.tools.includes('task_set_labels')) {
    throw new TaskError(
      'TASK_LABELS_FORBIDDEN',
      'This agent is no longer granted task_set_labels',
      403,
    );
  }
  const granted = new Set(agent.labelGrants.map(labelKey));
  const named = [...(patch.add ?? []), ...(patch.remove ?? [])];
  const notGranted = named.filter((name) => !granted.has(labelKey(name)));
  if (notGranted.length > 0) {
    throw new TaskError(
      'TASK_LABEL_NOT_GRANTED',
      'This agent may add or remove only the labels its grant names',
      403,
      { labels: notGranted },
    );
  }
  // Authorize before any write, even the lock's no-field-change UPDATE.
  await lockTaskRunStart(tx, args.organizationId, patch.taskId);
  const task = await loadTaskOrThrow(tx, patch.taskId, args.organizationId);
  assertTarget(task, args);
  // The task's own board spells each label; a granted name its catalog
  // lacks is unknown there, and is never created.
  const rows = await tx<{ name: string }[]>`
    SELECT name FROM app.task_labels
    WHERE org_id = ${args.organizationId} AND project_id = ${task.projectId}
      AND lower(name) = ANY(${[...new Set(named.map(labelKey))]})
  `;
  const catalog = new Map(rows.map((row) => [labelKey(row.name), row.name]));
  const unknown = named.filter((name) => !catalog.has(labelKey(name)));
  if (unknown.length > 0) {
    throw new TaskError('TASK_LABEL_UNKNOWN', 'Unknown label', 400, {
      labels: unknown,
    });
  }
  const current =
    (await readAgentTaskLabels(tx, args.organizationId, [task])).get(task.id) ??
    [];
  if (!sameLabels(current, patch.expected.labels)) {
    throw new TaskError(
      'TASK_METADATA_STALE',
      'Task metadata changed since it was read; read it again before deciding',
      409,
    );
  }
  const removed = new Set((patch.remove ?? []).map(labelKey));
  const next = current.filter((name) => !removed.has(labelKey(name)));
  for (const name of patch.add ?? []) {
    const spelled = catalog.get(labelKey(name)) ?? name;
    if (!sameLabels([...next, spelled], next)) next.push(spelled);
  }
  if (sameLabels(current, next)) {
    return { taskId: task.id, labels: current, changed: false };
  }
  await agentUpdateTaskLabelsTrusted(tx, {
    organizationId: args.organizationId,
    actorId: args.actorId,
    taskId: task.id,
    labels: next,
  });
  const stored = await loadTaskOrThrow(tx, task.id, args.organizationId);
  return {
    taskId: stored.id,
    labels:
      (await readAgentTaskLabels(tx, args.organizationId, [stored])).get(
        stored.id,
      ) ?? [],
    changed: true,
  };
}
