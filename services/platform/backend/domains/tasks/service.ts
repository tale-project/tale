import type { Sql, TransactionSql } from 'postgres';

import {
  checkProjectAccess,
  EDITOR_ROLES,
} from '../../../convex/projects/access.ts';
import { canClaimTask } from '../../../convex/tasks/access.ts';
import {
  TASK_AUDIT_ACTIONS,
  TASK_RESOURCE_TYPE,
} from '../../../convex/tasks/audit_actions.ts';
import { initialRank, rankBetween } from '../../../convex/tasks/rank.ts';
import {
  defaultTaskLabelColor,
  PREDEFINED_TASK_LABELS,
} from '../../../lib/shared/task-label-colors.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  autoSubscribe,
  notifyTaskAssigned,
  notifyTaskStatusChanged,
} from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import {
  listProjects,
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';
import { kickAgentRun } from './agent-runs.ts';
import {
  closePendingTaskReviewOnStatusLeave,
  collectPendingReviewsForProjects,
  requestTaskReview,
} from './reviews.ts';

/**
 * Tasks domain, Tier A — the task board core: CRUD, status choreography
 * (human semantics), polymorphic assignee, LexoRank ordering (rank module
 * reused), dependencies (DAG-guarded), label catalog, board views, activity
 * timeline, and the project rollup transitions. Access is INHERITED from the
 * parent project (reused matrix).
 *
 * Tier B lands with its infrastructure (ledger): discussion comments +
 * mentions (thread store), agent runs / review arc / status verbs that kick
 * runs, notify/event fan-outs, attachments/outputs blob validation (storage
 * router), REST surface, date-driven notifications (crons), bulk board ops.
 * Live-run guards on assignee changes return "no live run" until the run
 * domains land.
 */

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskAssigneeType = 'user' | 'agent' | 'app';

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'cancelled',
]);

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_LABELS_MAX = 50;
export const TASK_LABEL_CHARS_MAX = 50;
export const TASK_BOARD_CAP = 2000;

export class TaskError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 = 400,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export interface TaskRow {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string | null;
  attachments: unknown;
  outputs: unknown;
  number: number | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  labelIds: string[];
  assigneeType: TaskAssigneeType | null;
  assigneeId: string | null;
  reviewerUserId: string | null;
  parentTaskId: string | null;
  commentCount: number;
  rank: string;
  externalSystem: string | null;
  externalId: string | null;
  externalUrl: string | null;
  threadId: string | null;
  discussionThreadId: string | null;
  sourceDiscussionThreadId: string | null;
  startDate: number | null;
  startNotifiedAt: number | null;
  dueDate: number | null;
  slaLevel: number | null;
  slaLevelAt: number | null;
  statusChangedAt: number | null;
  totalCostCents: number | null;
  agentRunCount: number;
  lastAgentRunAt: number | null;
  claimedAt: number | null;
  completedAt: number | null;
  createdBy: string;
  createdByType: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export const TASK_COLUMNS = `
  id, org_id AS "organizationId", project_id AS "projectId", title,
  description, attachments, outputs, number, status, priority,
  label_ids AS "labelIds", assignee_type AS "assigneeType",
  assignee_id AS "assigneeId", reviewer_user_id AS "reviewerUserId",
  parent_task_id AS "parentTaskId", comment_count AS "commentCount", rank,
  external_system AS "externalSystem", external_id AS "externalId",
  external_url AS "externalUrl", thread_id AS "threadId",
  discussion_thread_id AS "discussionThreadId",
  source_discussion_thread_id AS "sourceDiscussionThreadId",
  start_date_ms::float8 AS "startDate",
  start_notified_at_ms::float8 AS "startNotifiedAt",
  due_date_ms::float8 AS "dueDate",
  sla_level AS "slaLevel", sla_level_at_ms::float8 AS "slaLevelAt",
  status_changed_at_ms::float8 AS "statusChangedAt",
  total_cost_cents AS "totalCostCents", agent_run_count AS "agentRunCount",
  last_agent_run_at_ms::float8 AS "lastAgentRunAt",
  claimed_at_ms::float8 AS "claimedAt",
  completed_at_ms::float8 AS "completedAt", created_by AS "createdBy",
  created_by_type AS "createdByType", created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt", archived_at_ms::float8 AS "archivedAt"
`;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function assertTaskReadable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new TaskError('TASK_FORBIDDEN', 'No project access', 403);
  }
}

export function assertTaskWritable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new TaskError('TASK_FORBIDDEN', 'No project access', 403);
  }
  if (!access.canEdit) {
    throw new TaskError('RBAC_FORBIDDEN', 'Editor role required', 403);
  }
}

function assertTaskNotArchived(task: TaskRow): void {
  if (task.archivedAt !== null) {
    throw new TaskError('TASK_ARCHIVED', 'Task is archived');
  }
}

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > TASK_TITLE_MAX) {
    throw new TaskError('TASK_TITLE_INVALID', 'Invalid title');
  }
  return trimmed;
}

function validateDescription(
  description: string | undefined,
): string | undefined {
  if (description == null) {
    return undefined;
  }
  if (description.length > TASK_DESCRIPTION_MAX) {
    throw new TaskError('TASK_DESCRIPTION_INVALID', 'Description too long');
  }
  return description;
}

function assertScheduleOrder(
  startDate: number | undefined | null,
  dueDate: number | undefined | null,
): void {
  if (startDate != null && dueDate != null && startDate > dueDate) {
    throw new TaskError('TASK_SCHEDULE_INVALID', 'startDate must be ≤ dueDate');
  }
}

export async function loadTaskOrThrow(
  sql: Sql | TransactionSql,
  taskId: string,
): Promise<TaskRow> {
  const rows = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE id = ${taskId} LIMIT 1
  `;
  const task = rows[0];
  if (!task) {
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  }
  return task;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface TaskLabelRow {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  color: string;
}

function normalizeLabelNames(
  labels: string[] | undefined,
): string[] | undefined {
  if (labels == null) {
    return undefined;
  }
  if (labels.length > TASK_LABELS_MAX) {
    throw new TaskError('TASK_LABELS_INVALID', 'Too many labels');
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = raw.trim().toLowerCase();
    if (label.length === 0 || label.length > TASK_LABEL_CHARS_MAX) {
      throw new TaskError('TASK_LABELS_INVALID', 'Invalid label name');
    }
    if (!seen.has(label)) {
      seen.add(label);
      normalized.push(label);
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve label names to project-scoped catalog ids; unknown names are
 * upserted on agent/automation paths (`createIfMissing`) and rejected on
 * human paths. Empty/undefined clears the task's labels.
 */
export async function resolveProjectLabels(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    names: string[] | undefined;
    createdBy: string;
    createIfMissing?: boolean;
  },
): Promise<string[] | undefined> {
  const names = normalizeLabelNames(args.names);
  if (names === undefined) {
    return undefined;
  }
  const now = Date.now();
  const ids: string[] = [];
  for (const name of names) {
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM app.task_labels
      WHERE project_id = ${args.projectId} AND name = ${name} LIMIT 1
    `;
    if (existing[0]) {
      ids.push(existing[0].id);
      continue;
    }
    if (args.createIfMissing !== true) {
      throw new TaskError('TASK_LABEL_UNKNOWN', 'Unknown label', 400, { name });
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.task_labels (
        org_id, project_id, name, color, created_by, created_at_ms,
        updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.projectId}, ${name},
        ${defaultTaskLabelColor(name)}, ${args.createdBy}, ${now}, ${now}
      )
      ON CONFLICT (project_id, name) DO UPDATE SET updated_at_ms = ${now}
      RETURNING id
    `;
    if (inserted[0]) {
      ids.push(inserted[0].id);
    }
  }
  return ids;
}

/** Idempotently seed the built-in labels (bug/feature/improvement). */
export async function ensureDefaultProjectLabels(
  tx: TransactionSql,
  args: { organizationId: string; projectId: string; createdBy: string },
): Promise<void> {
  const now = Date.now();
  for (const preset of PREDEFINED_TASK_LABELS) {
    await tx`
      INSERT INTO app.task_labels (
        org_id, project_id, name, color, created_by, created_at_ms,
        updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.projectId}, ${preset.name},
        ${preset.color}, ${args.createdBy}, ${now}, ${now}
      )
      ON CONFLICT (project_id, name) DO NOTHING
    `;
  }
}

export async function listTaskLabels(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<TaskLabelRow[]> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  const rows = await sql<TaskLabelRow[]>`
    SELECT id, org_id AS "organizationId", project_id AS "projectId", name,
           color
    FROM app.task_labels WHERE project_id = ${projectId}
    ORDER BY name ASC
  `;
  // Colour is always derived from the name — never a stored override.
  return rows.map((row) =>
    Object.assign(row, { color: defaultTaskLabelColor(row.name) }),
  );
}

export async function createTaskLabel(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { projectId: string; name: string },
): Promise<string> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertTaskWritable(project, auth);
  const ids = await resolveProjectLabels(tx, {
    organizationId: auth.organizationId,
    projectId: args.projectId,
    names: [args.name],
    createdBy: auth.userId,
    createIfMissing: true,
  });
  const id = ids?.[0];
  if (!id) {
    throw new TaskError('TASK_LABELS_INVALID', 'Invalid label name');
  }
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: args.projectId,
  });
  return id;
}

export async function renameTaskLabel(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { labelId: string; name: string },
): Promise<void> {
  const rows = await tx<{ projectId: string; name: string }[]>`
    SELECT project_id AS "projectId", name FROM app.task_labels
    WHERE id = ${args.labelId} LIMIT 1
  `;
  const label = rows[0];
  if (!label) {
    throw new TaskError('TASK_LABEL_UNKNOWN', 'Label not found', 404);
  }
  const project = await loadProjectOrThrow(tx, label.projectId);
  assertTaskWritable(project, auth);
  const normalized = normalizeLabelNames([args.name])?.[0];
  if (!normalized) {
    throw new TaskError('TASK_LABELS_INVALID', 'Invalid label name');
  }
  const clash = await tx<{ id: string }[]>`
    SELECT id FROM app.task_labels
    WHERE project_id = ${label.projectId} AND name = ${normalized}
      AND id <> ${args.labelId}
    LIMIT 1
  `;
  if (clash.length > 0) {
    throw new TaskError('TASK_LABEL_TAKEN', 'Label name taken');
  }
  await tx`
    UPDATE app.task_labels SET
      name = ${normalized}, color = ${defaultTaskLabelColor(normalized)},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.labelId}
  `;
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: label.projectId,
  });
}

/**
 * Delete a label. Without `detach`, a label still carried by any task is
 * refused (`TASK_LABEL_IN_USE` — the 0.4 confirm-flow contract); with it,
 * the label detaches from every task first.
 */
export async function deleteTaskLabel(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { labelId: string; detach?: boolean },
): Promise<void> {
  const rows = await tx<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.task_labels
    WHERE id = ${args.labelId} LIMIT 1
  `;
  const label = rows[0];
  if (!label) {
    throw new TaskError('TASK_LABEL_UNKNOWN', 'Label not found', 404);
  }
  const project = await loadProjectOrThrow(tx, label.projectId);
  assertTaskWritable(project, auth);
  if (args.detach !== true) {
    const inUse = await tx<{ id: string }[]>`
      SELECT id FROM app.tasks
      WHERE project_id = ${label.projectId} AND ${args.labelId} = ANY(label_ids)
      LIMIT 1
    `;
    if (inUse.length > 0) {
      throw new TaskError('TASK_LABEL_IN_USE', 'Label is in use');
    }
  }
  await tx`
    UPDATE app.tasks SET label_ids = array_remove(label_ids, ${args.labelId})
    WHERE project_id = ${label.projectId} AND ${args.labelId} = ANY(label_ids)
  `;
  await tx`DELETE FROM app.task_labels WHERE id = ${args.labelId}`;
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: label.projectId,
  });
}

// ---------------------------------------------------------------------------
// Rollups, numbering, rank, activity
// ---------------------------------------------------------------------------

type TaskCountBucket = 'open' | 'done' | 'none';

export function taskCountBucket(state: {
  status: string;
  archivedAt: number | null;
}): TaskCountBucket {
  if (state.archivedAt !== null) {
    return 'none';
  }
  if (state.status === 'done') {
    return 'done';
  }
  if (state.status === 'cancelled') {
    return 'none';
  }
  return 'open';
}

/** The ONE writer of projects.open/done task counts (bucket transition). */
export async function applyTaskCountTransition(
  tx: TransactionSql,
  projectId: string,
  before: TaskCountBucket,
  after: TaskCountBucket,
): Promise<void> {
  if (before === after) {
    return;
  }
  const openDelta = (after === 'open' ? 1 : 0) - (before === 'open' ? 1 : 0);
  const doneDelta = (after === 'done' ? 1 : 0) - (before === 'done' ? 1 : 0);
  await tx`
    UPDATE app.projects SET
      open_task_count = greatest(open_task_count + ${openDelta}, 0),
      done_task_count = greatest(done_task_count + ${doneDelta}, 0)
    WHERE id = ${projectId}
  `;
}

/** Claim the next per-project task number in the same transaction. */
export async function nextTaskNumber(
  tx: TransactionSql,
  projectId: string,
): Promise<number> {
  const rows = await tx<{ taskCounter: number }[]>`
    UPDATE app.projects SET task_counter = task_counter + 1
    WHERE id = ${projectId}
    RETURNING task_counter AS "taskCounter"
  `;
  const number = rows[0]?.taskCounter;
  if (number === undefined) {
    throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
  }
  return number;
}

/** Rank AFTER the current last row of (project, status) — append to column. */
export async function computeEndRank(
  tx: TransactionSql | Sql,
  projectId: string,
  status: string,
): Promise<string> {
  const rows = await tx<{ rank: string }[]>`
    SELECT rank FROM app.tasks
    WHERE project_id = ${projectId} AND status = ${status}
    ORDER BY rank DESC LIMIT 1
  `;
  const last = rows[0]?.rank;
  return last === undefined ? initialRank() : rankBetween(last, undefined);
}

export async function recordActivity(
  tx: TransactionSql,
  args: {
    task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>;
    actorType: 'user' | 'agent';
    actorId: string;
    action: string;
    fromValue?: string;
    toValue?: string;
  },
): Promise<void> {
  await tx`
    INSERT INTO app.task_activity (
      org_id, task_id, project_id, actor_type, actor_id, action,
      from_value, to_value, created_at_ms
    ) VALUES (
      ${args.task.organizationId}, ${args.task.id}, ${args.task.projectId},
      ${args.actorType}, ${args.actorId}, ${args.action},
      ${args.fromValue ?? null}, ${args.toValue ?? null}, ${Date.now()}
    )
  `;
  // Every task change writes its activity line, so this is the ONE spot that
  // tells browsers the board moved (org-wide `task` hint, in the same tx).
  await emitHintInTx(tx, {
    orgId: args.task.organizationId,
    entity: 'task',
    entityId: args.task.id,
  });
}

function taskAudit(
  auth: ProjectAuthContext,
  task: { id: string; title: string },
  action: string,
  extra: {
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  } = {},
) {
  return {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user' as const,
    action,
    category: 'data' as const,
    resourceType: TASK_RESOURCE_TYPE,
    resourceId: task.id,
    resourceName: task.title,
    status: 'success' as const,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Assignee validation
// ---------------------------------------------------------------------------

interface AssigneeRef {
  assigneeType: TaskAssigneeType;
  assigneeId: string;
}

function normalizeAssignee(args: {
  assigneeType?: TaskAssigneeType;
  assigneeId?: string;
}): AssigneeRef | null {
  const { assigneeType, assigneeId } = args;
  if (assigneeType === undefined && assigneeId === undefined) {
    return null;
  }
  if (assigneeType === undefined || !assigneeId) {
    throw new TaskError(
      'TASK_ASSIGNEE_INVALID',
      'assigneeType and assigneeId are set together',
    );
  }
  return { assigneeType, assigneeId };
}

/**
 * Validate an assignee against the project. Humans need project read access
 * (self always allowed); agents must be a projectAgents instance of THIS
 * project; automations (`app`) are accepted with the deployment check
 * deferred to the automations domain (ledger).
 */
async function assertAssigneeValid(
  tx: TransactionSql,
  args: {
    project: ProjectRow;
    auth: ProjectAuthContext;
    assignee: AssigneeRef | null;
  },
): Promise<void> {
  const { project, auth, assignee } = args;
  if (!assignee) {
    return;
  }
  if (assignee.assigneeType === 'user') {
    if (assignee.assigneeId === auth.userId) {
      return;
    }
    const member = await tx<{ role: string }[]>`
      SELECT "role" FROM "member"
      WHERE "organizationId" = ${auth.organizationId}
        AND "userId" = ${assignee.assigneeId}
      LIMIT 1
    `;
    const role = member[0]?.role.toLowerCase();
    if (!role || role === 'disabled') {
      throw new TaskError(
        'ASSIGNEE_NO_PROJECT_ACCESS',
        'Assignee lacks access',
      );
    }
    const teamRows = await tx<{ teamId: string }[]>`
      SELECT "teamId" FROM "teamMember" WHERE "userId" = ${assignee.assigneeId}
    `;
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      teamRows.map((row) => row.teamId),
      role,
    );
    if (!access.canRead) {
      throw new TaskError(
        'ASSIGNEE_NO_PROJECT_ACCESS',
        'Assignee lacks access',
      );
    }
    return;
  }
  if (assignee.assigneeType === 'agent') {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM app.project_agents
      WHERE id = ${assignee.assigneeId} AND project_id = ${project.id}
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new TaskError(
        'AGENT_NOT_ALLOWED_IN_PROJECT',
        'Agent is not an instance of this project',
      );
    }
  }
  // assigneeType 'app': TODO(automations) — deployment check.
}

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

export interface CreateTaskArgs {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assigneeType?: TaskAssigneeType;
  assigneeId?: string;
  parentTaskId?: string;
  startDate?: number;
  dueDate?: number;
}

export async function createTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: CreateTaskArgs,
): Promise<string> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  if (project.organizationId !== auth.organizationId) {
    throw new TaskError('ORG_FORBIDDEN', 'Wrong organization', 403);
  }
  assertTaskWritable(project, auth);

  const title = validateTitle(args.title);
  const description = validateDescription(args.description);
  const labelIds = await resolveProjectLabels(tx, {
    organizationId: auth.organizationId,
    projectId: args.projectId,
    names: args.labels,
    createdBy: auth.userId,
  });
  assertScheduleOrder(args.startDate, args.dueDate);
  const status = args.status ?? 'backlog';
  const assignee = normalizeAssignee(args);
  await assertAssigneeValid(tx, { project, auth, assignee });

  if (args.parentTaskId) {
    const parent = await loadTaskOrThrow(tx, args.parentTaskId);
    if (parent.projectId !== args.projectId) {
      throw new TaskError('TASK_PARENT_PROJECT_MISMATCH', 'Parent mismatch');
    }
    if (parent.archivedAt !== null) {
      throw new TaskError('TASK_PARENT_ARCHIVED', 'Parent archived');
    }
  }

  const now = Date.now();
  const rank = await computeEndRank(tx, args.projectId, status);
  const number = await nextTaskNumber(tx, args.projectId);

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.tasks (
      org_id, project_id, title, description, status, priority, label_ids,
      assignee_type, assignee_id, parent_task_id, start_date_ms, due_date_ms,
      rank, number, created_by, created_by_type, created_at_ms,
      updated_at_ms, status_changed_at_ms
    ) VALUES (
      ${auth.organizationId}, ${args.projectId}, ${title},
      ${description ?? null}, ${status}, ${args.priority ?? null},
      ${labelIds ?? []}, ${assignee?.assigneeType ?? null},
      ${assignee?.assigneeId ?? null}, ${args.parentTaskId ?? null},
      ${args.startDate ?? null}, ${args.dueDate ?? null}, ${rank}, ${number},
      ${auth.userId}, 'user', ${now}, ${now}, ${now}
    )
    RETURNING id
  `;
  const taskId = inserted[0]?.id;
  if (!taskId) {
    throw new TaskError('TASK_CREATE_FAILED', 'Insert failed');
  }
  await applyTaskCountTransition(
    tx,
    args.projectId,
    'none',
    taskCountBucket({ status, archivedAt: null }),
  );
  await recordActivity(tx, {
    task: {
      id: taskId,
      organizationId: auth.organizationId,
      projectId: args.projectId,
    },
    actorType: 'user',
    actorId: auth.userId,
    action: 'created',
    toValue: status,
  });
  await createAuditLog(
    tx,
    taskAudit(auth, { id: taskId, title }, TASK_AUDIT_ACTIONS.created, {
      newState: { status, priority: args.priority ?? null },
      metadata: {
        projectId: args.projectId,
        parentTaskId: args.parentTaskId ?? null,
        assigneeType: assignee?.assigneeType ?? null,
      },
    }),
  );
  await emitEvent(tx, {
    organizationId: auth.organizationId,
    eventType: 'task.created',
    eventData: {
      taskId,
      projectId: args.projectId,
      actorType: 'user',
      actorId: auth.userId,
    },
  });
  // The human creator starts following their task.
  await autoSubscribe(tx, {
    organizationId: auth.organizationId,
    taskId,
    subscriberType: 'user',
    subscriberId: auth.userId,
    reason: 'creator',
  });
  // TODO(collab): description mention fan-out rides the mention directory.
  return taskId;
}

export interface UpdateTaskArgs {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: TaskPriority | null;
  labels?: string[];
  startDate?: number | null;
  dueDate?: number | null;
  reviewerUserId?: string | null;
}

export async function updateTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: UpdateTaskArgs,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, args.taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);

  const previousState: Record<string, unknown> = {};
  const newState: Record<string, unknown> = {};

  let title = task.title;
  if (args.title !== undefined) {
    title = validateTitle(args.title);
    previousState.title = task.title;
    newState.title = title;
  }
  let description = task.description;
  if (args.description !== undefined) {
    description =
      args.description === null
        ? null
        : (validateDescription(args.description) ?? null);
    previousState.description = task.description;
    newState.description = description;
  }
  let priority = task.priority;
  if (args.priority !== undefined) {
    priority = args.priority;
    previousState.priority = task.priority;
    newState.priority = priority;
  }
  let labelIds = task.labelIds;
  if (args.labels !== undefined) {
    labelIds =
      (await resolveProjectLabels(tx, {
        organizationId: auth.organizationId,
        projectId: task.projectId,
        names: args.labels,
        createdBy: auth.userId,
      })) ?? [];
    previousState.labelIds = task.labelIds;
    newState.labelIds = labelIds;
  }
  const startDate =
    args.startDate === undefined ? task.startDate : args.startDate;
  const dueDate = args.dueDate === undefined ? task.dueDate : args.dueDate;
  assertScheduleOrder(startDate, dueDate);
  if (args.startDate !== undefined) {
    previousState.startDate = task.startDate;
    newState.startDate = startDate;
  }
  if (args.dueDate !== undefined) {
    previousState.dueDate = task.dueDate;
    newState.dueDate = dueDate;
  }
  let reviewerUserId = task.reviewerUserId;
  if (args.reviewerUserId !== undefined) {
    reviewerUserId = args.reviewerUserId;
    previousState.reviewerUserId = task.reviewerUserId;
    newState.reviewerUserId = reviewerUserId;
  }

  if (Object.keys(newState).length === 0) {
    return;
  }
  await tx`
    UPDATE app.tasks SET
      title = ${title}, description = ${description},
      priority = ${priority}, label_ids = ${labelIds},
      start_date_ms = ${startDate}, due_date_ms = ${dueDate},
      reviewer_user_id = ${reviewerUserId}, updated_at_ms = ${Date.now()}
    WHERE id = ${args.taskId}
  `;
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'updated',
  });
  await createAuditLog(
    tx,
    taskAudit(auth, { id: task.id, title }, TASK_AUDIT_ACTIONS.updated, {
      previousState,
      newState,
    }),
  );
}

export async function hasOpenChildren(
  tx: TransactionSql,
  taskId: string,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.tasks
    WHERE parent_task_id = ${taskId}
      AND archived_at_ms IS NULL
      AND status NOT IN ('done', 'cancelled')
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function updateTaskStatus(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);
  if (task.status === status) {
    return;
  }
  if (TERMINAL_STATUSES.has(status) && (await hasOpenChildren(tx, taskId))) {
    throw new TaskError('TASK_HAS_OPEN_SUBTASKS', 'Open subtasks remain');
  }
  // Leaving `in_review` closes the review gate: Done records the approve
  // (the org's `review_policy` still applies, so the picker cannot decide
  // what the respond door would refuse); any other leave withdraws it.
  await closePendingTaskReviewOnStatusLeave(tx, {
    task,
    toStatus: status,
    actor: {
      kind: 'user',
      userId: auth.userId,
      ...(auth.email !== undefined ? { email: auth.email } : {}),
    },
  });

  const now = Date.now();
  const rank = await computeEndRank(tx, task.projectId, status);
  const completedAt = TERMINAL_STATUSES.has(status)
    ? (task.completedAt ?? now)
    : null;
  await tx`
    UPDATE app.tasks SET
      status = ${status}, rank = ${rank}, completed_at_ms = ${completedAt},
      updated_at_ms = ${now}, status_changed_at_ms = ${now}
    WHERE id = ${taskId}
  `;
  await applyTaskCountTransition(
    tx,
    task.projectId,
    taskCountBucket(task),
    taskCountBucket({ status, archivedAt: task.archivedAt }),
  );
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'status.changed',
    fromValue: task.status,
    toValue: status,
  });
  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.statusChanged, {
      previousState: { status: task.status },
      newState: { status },
    }),
  );
  await emitEvent(tx, {
    organizationId: auth.organizationId,
    eventType: 'task.status_changed',
    eventData: {
      taskId,
      projectId: task.projectId,
      fromStatus: task.status,
      toStatus: status,
      actorType: 'user',
      actorId: auth.userId,
    },
  });
  // The status choreography's agent kick: an agent-owned task moving to
  // in_progress starts (or reuses) a run in the SAME transaction as the
  // status write — the board never shows an in-progress agent task with no
  // run behind it.
  if (
    status === 'in_progress' &&
    task.assigneeType === 'agent' &&
    task.assigneeId !== null
  ) {
    const agents = await tx<
      {
        id: string;
        harness: string;
        model: string;
        modelProvider: string | null;
      }[]
    >`
      SELECT id, harness, model, model_provider AS "modelProvider"
      FROM app.project_agents
      WHERE id = ${task.assigneeId} AND org_id = ${auth.organizationId}
      LIMIT 1
    `;
    const agent = agents[0];
    if (agent) {
      await kickAgentRun(tx, {
        organizationId: auth.organizationId,
        projectId: task.projectId,
        taskId,
        agentId: agent.id,
        harness: agent.harness,
        model: agent.model,
        ...(agent.modelProvider !== null
          ? { modelProvider: agent.modelProvider }
          : {}),
        startedBy: auth.userId,
        trigger: 'manual',
      });
    }
  }
  // Reaching `in_review` IS the request for review, whoever submitted —
  // the gate belongs to the STATE, not to the agent lane.
  if (status === 'in_review') {
    await requestTaskReview(tx, {
      task: { ...task, status: 'in_review' },
      trigger: { kind: 'human', actorId: auth.userId },
    });
  }
  await notifyTaskStatusChanged(tx, {
    task,
    fromStatus: task.status,
    toStatus: status,
    actorType: 'user',
    actorId: auth.userId,
  });
}

/**
 * TRUSTED agent-side status flip — the settle's park to `in_review` (and the
 * failure paths that leave `in_progress` alone). The turn host already
 * resolved authority (the run belongs to the agent); this is the lower half:
 * status + rank + rollup + activity, attributed to the agent actor. The
 * review-row mint (task_review + reviewer bell) lands with the review arc.
 */
export async function agentUpdateTaskStatusTrusted(
  tx: TransactionSql,
  args: {
    organizationId: string;
    actorId: string;
    taskId: string;
    status: TaskStatus;
    /** Present only on the settle park to `in_review`: mint the run's
     * workflow-free review in the SAME transaction as the flip (find-or-
     * insert by runId — the burned-claim replay never double-mints). */
    review?: { runId: string };
  },
): Promise<{ ok: boolean; reason?: string }> {
  const task = await loadTaskOrThrow(tx, args.taskId);
  if (task.organizationId !== args.organizationId) {
    return { ok: false, reason: 'wrong organization' };
  }
  const mintReview = async (): Promise<void> => {
    if (args.review === undefined || args.status !== 'in_review') return;
    const fresh = await loadTaskOrThrow(tx, args.taskId);
    if (fresh.status !== 'in_review') return;
    await requestTaskReview(tx, {
      task: fresh,
      trigger: { kind: 'agent_run', runId: args.review.runId },
    });
  };
  if (task.status === args.status) {
    await mintReview();
    return { ok: true };
  }
  if (TERMINAL_STATUSES.has(args.status)) {
    return { ok: false, reason: 'agents never complete work' };
  }
  // A non-human leave from `in_review` WITHDRAWS any pending review — no
  // human decided, so nothing is recorded as approved.
  await closePendingTaskReviewOnStatusLeave(tx, {
    task,
    toStatus: args.status,
    actor: { kind: 'system', actorId: args.actorId },
  });
  const now = Date.now();
  const rank = await computeEndRank(tx, task.projectId, args.status);
  await tx`
    UPDATE app.tasks SET
      status = ${args.status}, rank = ${rank}, updated_at_ms = ${now},
      status_changed_at_ms = ${now}
    WHERE id = ${args.taskId}
  `;
  await applyTaskCountTransition(
    tx,
    task.projectId,
    taskCountBucket(task),
    taskCountBucket({ status: args.status, archivedAt: task.archivedAt }),
  );
  await recordActivity(tx, {
    task,
    actorType: 'agent',
    actorId: args.actorId,
    action: 'status.changed',
    fromValue: task.status,
    toValue: args.status,
  });
  await notifyTaskStatusChanged(tx, {
    task,
    fromStatus: task.status,
    toStatus: args.status,
    actorType: 'agent',
    actorId: args.actorId,
  });
  await mintReview();
  return { ok: true };
}

/**
 * TRUSTED deliverables merge into the task's Output zone (same fileName ⇒
 * replace) — the settle's attach step.
 */
export async function agentRecordTaskOutputsTrusted(
  tx: TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
    files: Array<{
      fileId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    }>;
  },
): Promise<void> {
  if (args.files.length === 0) return;
  const task = await loadTaskOrThrow(tx, args.taskId);
  if (task.organizationId !== args.organizationId) return;
  const next: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }> = Array.isArray(task.outputs)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the outputs column is written only by this shape
      ([...task.outputs] as Array<{
        fileId: string;
        fileName: string;
        fileType: string;
        fileSize: number;
      }>)
    : [];
  for (const file of args.files) {
    const fileName = file.fileName.slice(0, 255);
    if (fileName === '') continue;
    const entry = { ...file, fileName };
    const at = next.findIndex((output) => output.fileName === fileName);
    if (at === -1) next.push(entry);
    else next[at] = entry;
  }
  await tx`
    UPDATE app.tasks SET
      outputs = ${tx.json(toJson(next))}, updated_at_ms = ${Date.now()}
    WHERE id = ${args.taskId}
  `;
}

export async function assignTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    taskId: string;
    assigneeType?: TaskAssigneeType;
    assigneeId?: string;
  },
): Promise<void> {
  const task = await loadTaskOrThrow(tx, args.taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);

  const assignee = normalizeAssignee(args);
  await assertAssigneeValid(tx, { project, auth, assignee });
  // TODO(agent runs/automations): reject while a live run holds the task.

  const previousAssigneeId = task.assigneeId;
  await tx`
    UPDATE app.tasks SET
      assignee_type = ${assignee?.assigneeType ?? null},
      assignee_id = ${assignee?.assigneeId ?? null},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.taskId}
  `;
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'assignee.changed',
    ...(previousAssigneeId !== null ? { fromValue: previousAssigneeId } : {}),
    ...(assignee !== null ? { toValue: assignee.assigneeId } : {}),
  });
  await createAuditLog(
    tx,
    taskAudit(
      auth,
      task,
      assignee ? TASK_AUDIT_ACTIONS.assigned : TASK_AUDIT_ACTIONS.unassigned,
      {
        previousState: {
          assigneeType: task.assigneeType,
          assigneeId: task.assigneeId,
        },
        newState: {
          assigneeType: assignee?.assigneeType ?? null,
          assigneeId: assignee?.assigneeId ?? null,
        },
      },
    ),
  );
  await notifyTaskAssigned(tx, {
    task,
    assigneeType: assignee?.assigneeType ?? null,
    assigneeId: assignee?.assigneeId ?? null,
    actorType: 'user',
    actorId: auth.userId,
    previousAssigneeType: task.assigneeType,
    previousAssigneeId: task.assigneeId,
  });
}

/** Self-serve claim of an unassigned task. */
export async function claimTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ claimed: boolean; reason?: string }> {
  const task = await loadTaskOrThrow(tx, taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);
  // A contested claim is a RESULT, not an error (the 0.4 wire): the loser's
  // UI shows "already claimed", nothing throws. The serializable tx makes
  // exactly one claimer win.
  if (!canClaimTask(task)) {
    return { claimed: false, reason: 'ALREADY_CLAIMED' };
  }
  await tx`
    UPDATE app.tasks SET
      assignee_type = 'user', assignee_id = ${auth.userId},
      claimed_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
    WHERE id = ${taskId}
  `;
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'claimed',
    toValue: auth.userId,
  });
  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.claimed, {
      newState: { assigneeType: 'user', assigneeId: auth.userId },
    }),
  );
  return { claimed: true };
}

/** Board drag: move to (status, position) — rank between the neighbour
 * CARDS (the 0.4 wire sends task ids; ranks resolve here). */
export async function moveTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    taskId: string;
    status: TaskStatus;
    beforeTaskId?: string;
    afterTaskId?: string;
  },
): Promise<void> {
  const task = await loadTaskOrThrow(tx, args.taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);

  const statusChanges = task.status !== args.status;
  if (
    statusChanges &&
    TERMINAL_STATUSES.has(args.status) &&
    (await hasOpenChildren(tx, args.taskId))
  ) {
    throw new TaskError('TASK_HAS_OPEN_SUBTASKS', 'Open subtasks remain');
  }
  if (statusChanges) {
    // Same gate as updateTaskStatus — the drag is just another status door.
    await closePendingTaskReviewOnStatusLeave(tx, {
      task,
      toStatus: args.status,
      actor: {
        kind: 'user',
        userId: auth.userId,
        ...(auth.email !== undefined ? { email: auth.email } : {}),
      },
    });
  }
  const rankOf = async (
    id: string | undefined,
  ): Promise<string | undefined> => {
    if (id === undefined) return undefined;
    const rows = await tx<{ rank: string }[]>`
      SELECT rank FROM app.tasks WHERE id = ${id} LIMIT 1
    `;
    return rows[0]?.rank;
  };
  const beforeRank = await rankOf(args.beforeTaskId);
  const afterRank = await rankOf(args.afterTaskId);
  let rank: string;
  if (beforeRank === undefined && afterRank === undefined) {
    rank = await computeEndRank(tx, task.projectId, args.status);
  } else {
    try {
      rank = rankBetween(beforeRank, afterRank);
    } catch (error) {
      // Neighbours out of order / stale (or no key fits between them) — fall
      // back to the end of the column rather than persisting a bad rank.
      console.warn('[tasks] moveTask: rankBetween failed, appending', error);
      rank = await computeEndRank(tx, task.projectId, args.status);
    }
  }
  const now = Date.now();
  const completedAt = statusChanges
    ? TERMINAL_STATUSES.has(args.status)
      ? (task.completedAt ?? now)
      : null
    : task.completedAt;
  await tx`
    UPDATE app.tasks SET
      status = ${args.status}, rank = ${rank},
      completed_at_ms = ${completedAt}, updated_at_ms = ${now},
      status_changed_at_ms = ${statusChanges ? now : task.statusChangedAt}
    WHERE id = ${args.taskId}
  `;
  if (statusChanges) {
    await applyTaskCountTransition(
      tx,
      task.projectId,
      taskCountBucket(task),
      taskCountBucket({ status: args.status, archivedAt: task.archivedAt }),
    );
    await recordActivity(tx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'status.changed',
      fromValue: task.status,
      toValue: args.status,
    });
    await createAuditLog(
      tx,
      taskAudit(auth, task, TASK_AUDIT_ACTIONS.statusChanged, {
        previousState: { status: task.status },
        newState: { status: args.status },
      }),
    );
    if (args.status === 'in_review') {
      await requestTaskReview(tx, {
        task: { ...task, status: 'in_review' },
        trigger: { kind: 'human', actorId: auth.userId },
      });
    }
  }
}

export async function archiveTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  if (task.archivedAt !== null) {
    return;
  }
  const now = Date.now();
  await tx`
    UPDATE app.tasks SET archived_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${taskId}
  `;
  await applyTaskCountTransition(
    tx,
    task.projectId,
    taskCountBucket(task),
    'none',
  );
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'archived',
  });
  await createAuditLog(tx, taskAudit(auth, task, TASK_AUDIT_ACTIONS.archived));
}

export async function restoreTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  if (task.archivedAt === null) {
    return;
  }
  const now = Date.now();
  await tx`
    UPDATE app.tasks SET archived_at_ms = NULL, updated_at_ms = ${now}
    WHERE id = ${taskId}
  `;
  await applyTaskCountTransition(
    tx,
    task.projectId,
    'none',
    taskCountBucket({ status: task.status, archivedAt: null }),
  );
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'restored',
  });
  await createAuditLog(tx, taskAudit(auth, task, TASK_AUDIT_ACTIONS.restored));
}

/**
 * Hard delete — admin-only (0.4 contract). Deletes the WHOLE SUBTREE
 * (subtasks recursively) with each task's discussion thread; returns how
 * many children went with it (the confirm dialog names the count).
 */
export async function deleteTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ deletedChildCount: number }> {
  const task = await loadTaskOrThrow(tx, taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  if (!['owner', 'admin'].includes(auth.role)) {
    throw new TaskError('ROLE_FORBIDDEN', 'Admin role required', 403);
  }
  const tree = await tx<
    {
      id: string;
      status: TaskStatus;
      archivedAt: number | null;
      discussionThreadId: string | null;
    }[]
  >`
    WITH RECURSIVE tree AS (
      SELECT id, status, archived_at_ms, discussion_thread_id, 0 AS depth
      FROM app.tasks WHERE id = ${taskId}
      UNION ALL
      SELECT t.id, t.status, t.archived_at_ms, t.discussion_thread_id,
             tree.depth + 1
      FROM app.tasks t JOIN tree ON t.parent_task_id = tree.id
      WHERE tree.depth < 32
    )
    SELECT id, status, archived_at_ms::float8 AS "archivedAt",
           discussion_thread_id AS "discussionThreadId"
    FROM tree
  `;
  const ids = tree.map((row) => row.id);
  for (const row of tree) {
    await applyTaskCountTransition(
      tx,
      task.projectId,
      taskCountBucket({ status: row.status, archivedAt: row.archivedAt }),
      'none',
    );
  }
  // Discussion threads die with their tasks (messages + meta cascade by FK).
  const threadIds = tree
    .map((row) => row.discussionThreadId)
    .filter((id): id is string => id !== null);
  if (threadIds.length > 0) {
    await tx`DELETE FROM app.threads WHERE id = ANY(${threadIds})`;
  }
  await tx`DELETE FROM app.tasks WHERE id = ANY(${ids})`;
  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.deleted, {
      previousState: { status: task.status, title: task.title },
      metadata: { deletedChildCount: ids.length - 1 },
    }),
  );
  // Deletes leave no activity row (the task is gone) — hint explicitly.
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: taskId,
  });
  // TODO(storage router): delete attachment/output blobs with the task.
  return { deletedChildCount: ids.length - 1 };
}

// ---------------------------------------------------------------------------
// Dependencies (advisory DAG)
// ---------------------------------------------------------------------------

/** BFS from `from` along blocker→blocked edges; true if `target` reachable. */
async function dependencyPathExists(
  tx: TransactionSql,
  projectId: string,
  from: string,
  target: string,
): Promise<boolean> {
  const rows = await tx<{ blockerTaskId: string; blockedTaskId: string }[]>`
    SELECT blocker_task_id AS "blockerTaskId", blocked_task_id AS "blockedTaskId"
    FROM app.task_dependencies WHERE project_id = ${projectId}
  `;
  const edges = new Map<string, string[]>();
  for (const row of rows) {
    const list = edges.get(row.blockerTaskId) ?? [];
    list.push(row.blockedTaskId);
    edges.set(row.blockerTaskId, list);
  }
  const queue = [from];
  const seen = new Set<string>([from]);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    if (node === target) {
      return true;
    }
    for (const next of edges.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export async function addTaskDependency(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { blockerTaskId: string; blockedTaskId: string },
): Promise<void> {
  if (args.blockerTaskId === args.blockedTaskId) {
    throw new TaskError('TASK_DEPENDENCY_SELF', 'A task cannot block itself');
  }
  const blocker = await loadTaskOrThrow(tx, args.blockerTaskId);
  const blocked = await loadTaskOrThrow(tx, args.blockedTaskId);
  if (blocker.projectId !== blocked.projectId) {
    throw new TaskError(
      'TASK_DEPENDENCY_PROJECT_MISMATCH',
      'Dependencies stay within one project',
    );
  }
  const project = await loadProjectOrThrow(tx, blocker.projectId);
  assertTaskWritable(project, auth);

  // Adding blocker→blocked creates a cycle iff blocker is reachable FROM
  // blocked already.
  if (
    await dependencyPathExists(
      tx,
      blocker.projectId,
      args.blockedTaskId,
      args.blockerTaskId,
    )
  ) {
    throw new TaskError('TASK_DEPENDENCY_CYCLE', 'Dependency would cycle');
  }
  const inserted = await tx`
    INSERT INTO app.task_dependencies (
      org_id, project_id, blocker_task_id, blocked_task_id, created_by,
      created_by_type, created_at_ms
    ) VALUES (
      ${auth.organizationId}, ${blocker.projectId}, ${args.blockerTaskId},
      ${args.blockedTaskId}, ${auth.userId}, 'user', ${Date.now()}
    )
    ON CONFLICT (blocker_task_id, blocked_task_id) DO NOTHING
  `;
  if (inserted.count === 0) {
    return;
  }
  await recordActivity(tx, {
    task: blocked,
    actorType: 'user',
    actorId: auth.userId,
    action: 'dependency.added',
    toValue: args.blockerTaskId,
  });
  await createAuditLog(
    tx,
    taskAudit(auth, blocked, TASK_AUDIT_ACTIONS.dependencyAdded, {
      metadata: { blockerTaskId: args.blockerTaskId },
    }),
  );
}

export async function removeTaskDependency(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { blockerTaskId: string; blockedTaskId: string },
): Promise<void> {
  const blocked = await loadTaskOrThrow(tx, args.blockedTaskId);
  const project = await loadProjectOrThrow(tx, blocked.projectId);
  assertTaskWritable(project, auth);
  const deleted = await tx`
    DELETE FROM app.task_dependencies
    WHERE blocker_task_id = ${args.blockerTaskId}
      AND blocked_task_id = ${args.blockedTaskId}
  `;
  if (deleted.count === 0) {
    return;
  }
  await recordActivity(tx, {
    task: blocked,
    actorType: 'user',
    actorId: auth.userId,
    action: 'dependency.removed',
    fromValue: args.blockerTaskId,
  });
  await createAuditLog(
    tx,
    taskAudit(auth, blocked, TASK_AUDIT_ACTIONS.dependencyRemoved, {
      metadata: { blockerTaskId: args.blockerTaskId },
    }),
  );
}

// ---------------------------------------------------------------------------
// Board views
// ---------------------------------------------------------------------------

export interface BoardViewInput {
  projectId: string;
  viewId?: string;
  name: string;
  scope: 'personal' | 'shared';
  viewType: 'board' | 'table' | 'timeline';
  filters: Record<string, unknown>;
  sort?: { field: string; desc: boolean };
  isDefault?: boolean;
}

export async function saveBoardView(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: BoardViewInput,
): Promise<string> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertTaskReadable(project, auth);
  const now = Date.now();
  if (args.viewId) {
    const rows = await tx<{ ownerId: string; scope: string }[]>`
      SELECT owner_id AS "ownerId", scope FROM app.board_views
      WHERE id = ${args.viewId} AND project_id = ${args.projectId} LIMIT 1
    `;
    const view = rows[0];
    if (!view) {
      throw new TaskError('BOARD_VIEW_NOT_FOUND', 'View not found', 404);
    }
    if (view.ownerId !== auth.userId && view.scope === 'personal') {
      throw new TaskError('BOARD_VIEW_FORBIDDEN', 'Not your view', 403);
    }
    await tx`
      UPDATE app.board_views SET
        name = ${args.name}, scope = ${args.scope},
        view_type = ${args.viewType},
        filters = ${tx.json(toJson(args.filters))},
        sort = ${args.sort === undefined ? null : tx.json(toJson(args.sort))},
        is_default = ${args.isDefault ?? null}, updated_at_ms = ${now}
      WHERE id = ${args.viewId}
    `;
    return args.viewId;
  }
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.board_views (
      org_id, project_id, owner_id, name, scope, view_type, filters, sort,
      is_default, created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${args.projectId}, ${auth.userId}, ${args.name},
      ${args.scope}, ${args.viewType}, ${tx.json(toJson(args.filters))},
      ${args.sort === undefined ? null : tx.json(toJson(args.sort))},
      ${args.isDefault ?? null}, ${now}, ${now}
    )
    RETURNING id
  `;
  const id = inserted[0]?.id;
  if (!id) {
    throw new TaskError('BOARD_VIEW_SAVE_FAILED', 'Insert failed');
  }
  return id;
}

export async function deleteBoardView(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  viewId: string,
): Promise<void> {
  const rows = await tx<
    { ownerId: string; scope: string; projectId: string }[]
  >`
    SELECT owner_id AS "ownerId", scope, project_id AS "projectId"
    FROM app.board_views WHERE id = ${viewId} LIMIT 1
  `;
  const view = rows[0];
  if (!view) {
    return;
  }
  const project = await loadProjectOrThrow(tx, view.projectId);
  assertTaskReadable(project, auth);
  if (view.ownerId !== auth.userId && view.scope === 'personal') {
    throw new TaskError('BOARD_VIEW_FORBIDDEN', 'Not your view', 403);
  }
  await tx`DELETE FROM app.board_views WHERE id = ${viewId}`;
}

export interface BoardViewRow {
  id: string;
  name: string;
  scope: string;
  viewType: string;
  filters: unknown;
  sort: unknown;
  isDefault: boolean | null;
  ownerId: string;
}

export async function listBoardViews(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<BoardViewRow[]> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  return sql<BoardViewRow[]>`
    SELECT id, name, scope, view_type AS "viewType", filters, sort,
           is_default AS "isDefault", owner_id AS "ownerId"
    FROM app.board_views
    WHERE project_id = ${projectId}
      AND (scope = 'shared' OR owner_id = ${auth.userId})
    ORDER BY created_at_ms ASC
  `;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The board read: every non-archived task of a project (capped). */
// ---------------------------------------------------------------------------
// Board reads — the 0.4 wire decorations (resolved labels, folder facts)
// ---------------------------------------------------------------------------

/** One resolved label DTO as the 0.4 `taskLabelRowValidator` ships it. */
export interface ResolvedTaskLabel {
  id: string;
  name: string;
  color: string;
}

/** A task row decorated for the wire: resolved labels + folder-input facts
 * (+ the all-projects board's `projectKey` stamp). */
export interface DecoratedTaskRow extends TaskRow {
  labels: ResolvedTaskLabel[];
  folderExists: boolean;
  hasFiles: boolean;
  projectKey?: string;
}

export interface TaskListFilters {
  includeArchived?: boolean;
  status?: string;
  statuses?: string[];
  assigneeId?: string;
  externalSystem?: string;
}

/** Batch-resolve the page's label ids to catalog DTOs (color derived, the
 * 0.4 rule — the catalog stores names, the palette is deterministic). */
async function resolveLabelMap(
  sql: Sql,
  tasks: readonly TaskRow[],
): Promise<Map<string, ResolvedTaskLabel>> {
  const ids = [...new Set(tasks.flatMap((task) => task.labelIds))];
  if (ids.length === 0) return new Map();
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM app.task_labels WHERE id = ANY(${ids})
  `;
  return new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, name: row.name, color: defaultTaskLabelColor(row.name) },
    ]),
  );
}

/**
 * Folder-input subject facts for a page of tasks (the 0.4
 * `collectFolderFacts`): per DISTINCT bound folder (`externalId`), whether it
 * still exists in this org+project and whether its SUBTREE holds ≥1 active
 * document with a file (a trashed doc must not count; subfolders count —
 * a delivery filed under "Documentation/" keeps Start visible).
 */
async function collectFolderFacts(
  sql: Sql,
  organizationId: string,
  projectId: string,
  tasks: readonly TaskRow[],
): Promise<{ existingFolders: Set<string>; foldersWithFiles: Set<string> }> {
  const folderIds = [
    ...new Set(
      tasks
        .map((task) => task.externalId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (folderIds.length === 0) {
    return { existingFolders: new Set(), foldersWithFiles: new Set() };
  }
  const rows = await sql<{ rootId: string; hasFiles: boolean }[]>`
    WITH RECURSIVE tree AS (
      SELECT f.id AS root_id, f.id, 0 AS depth
      FROM app.folders f
      WHERE f.id = ANY(${folderIds})
        AND f.org_id = ${organizationId}
        AND f.project_id = ${projectId}
      UNION ALL
      SELECT t.root_id, f.id, t.depth + 1
      FROM app.folders f
      JOIN tree t ON f.parent_id = t.id
      WHERE t.depth < 16
    )
    SELECT root_id AS "rootId",
           bool_or(EXISTS (
             SELECT 1 FROM app.documents d
             WHERE d.folder_id = tree.id
               AND d.org_id = ${organizationId}
               AND d.file_ref IS NOT NULL
               AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
           )) AS "hasFiles"
    FROM tree
    GROUP BY root_id
  `;
  return {
    existingFolders: new Set(rows.map((row) => row.rootId)),
    foldersWithFiles: new Set(
      rows.filter((row) => row.hasFiles).map((row) => row.rootId),
    ),
  };
}

function decorateTaskRow(
  task: TaskRow,
  labelMap: ReadonlyMap<string, ResolvedTaskLabel>,
  facts: { existingFolders: Set<string>; foldersWithFiles: Set<string> },
): DecoratedTaskRow {
  return Object.assign(task, {
    labels: task.labelIds
      .map((id) => labelMap.get(id))
      .filter((label): label is ResolvedTaskLabel => label !== undefined),
    folderExists:
      task.externalId === null || facts.existingFolders.has(task.externalId),
    hasFiles:
      task.externalId !== null && facts.foldersWithFiles.has(task.externalId),
  });
}

async function decorateProjectPage(
  sql: Sql,
  organizationId: string,
  projectId: string,
  tasks: TaskRow[],
): Promise<DecoratedTaskRow[]> {
  const labelMap = await resolveLabelMap(sql, tasks);
  const facts = await collectFolderFacts(sql, organizationId, projectId, tasks);
  return tasks.map((task) => decorateTaskRow(task, labelMap, facts));
}

/** The shared board filter clause (each filter optional, ANDed). */
function boardFilterClause(sql: Sql, filters: TaskListFilters) {
  const includeArchived = filters.includeArchived ?? false;
  const status = filters.status ?? null;
  const statuses = filters.statuses ?? null;
  const assigneeId = filters.assigneeId ?? null;
  const externalSystem = filters.externalSystem ?? null;
  return sql`
    (${includeArchived} OR archived_at_ms IS NULL)
    AND (${status}::text IS NULL OR status = ${status})
    AND (${statuses === null} OR status = ANY(${statuses ?? []}))
    AND (${assigneeId}::text IS NULL OR assignee_id = ${assigneeId})
    AND (${externalSystem}::text IS NULL OR external_system = ${externalSystem})
  `;
}

export async function listTasksByProject(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
  filters: TaskListFilters = {},
): Promise<{
  tasks: DecoratedTaskRow[];
  truncated: boolean;
  canEdit: boolean;
}> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  const canEdit = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  ).canEdit;
  const rows = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE project_id = ${projectId}
      AND ${boardFilterClause(sql, filters)}
    ORDER BY status ASC, rank ASC
    LIMIT ${TASK_BOARD_CAP + 1}
  `;
  const truncated = rows.length > TASK_BOARD_CAP;
  const page = truncated ? rows.slice(0, TASK_BOARD_CAP) : rows;
  return {
    tasks: await decorateProjectPage(sql, auth.organizationId, projectId, page),
    truncated,
    canEdit,
  };
}

/**
 * All-projects board: every task in projects the caller can read (newest
 * activity first, then re-grouped (status, rank) — the 0.4 walk), each row
 * stamped with its project's key so cards can render `KEY-123` without a
 * second lookup. `canEdit` is role-level (editor+), the per-write gates stay
 * server-side.
 */
export async function listTasksForAccessibleProjects(
  sql: Sql,
  auth: ProjectAuthContext,
  filters: TaskListFilters = {},
): Promise<{
  tasks: DecoratedTaskRow[];
  truncated: boolean;
  canEdit: boolean;
}> {
  const projects = await listProjects(sql, auth);
  const canEdit = EDITOR_ROLES.has(auth.role);
  if (projects.length === 0) {
    return { tasks: [], truncated: false, canEdit };
  }
  const projectKeys = new Map(
    projects.map((project) => [project.id, project.key]),
  );
  const rows = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE org_id = ${auth.organizationId}
      AND project_id = ANY(${[...projectKeys.keys()]})
      AND ${boardFilterClause(sql, filters)}
    ORDER BY updated_at_ms DESC
    LIMIT ${TASK_BOARD_CAP + 1}
  `;
  const truncated = rows.length > TASK_BOARD_CAP;
  const page = truncated ? rows.slice(0, TASK_BOARD_CAP) : rows;
  page.sort((a, b) =>
    a.status === b.status
      ? a.rank.localeCompare(b.rank)
      : a.status.localeCompare(b.status),
  );

  // Folder facts are per-project — group the page, stamp, then merge.
  const labelMap = await resolveLabelMap(sql, page);
  const byProject = new Map<string, TaskRow[]>();
  for (const task of page) {
    const group = byProject.get(task.projectId);
    if (group) group.push(task);
    else byProject.set(task.projectId, [task]);
  }
  const merged = {
    existingFolders: new Set<string>(),
    foldersWithFiles: new Set<string>(),
  };
  for (const [projectId, projectRows] of byProject) {
    const facts = await collectFolderFacts(
      sql,
      auth.organizationId,
      projectId,
      projectRows,
    );
    for (const id of facts.existingFolders) merged.existingFolders.add(id);
    for (const id of facts.foldersWithFiles) merged.foldersWithFiles.add(id);
  }
  return {
    tasks: page.map((task) => {
      const key = projectKeys.get(task.projectId) ?? null;
      const decorated = decorateTaskRow(task, labelMap, merged);
      return key !== null
        ? Object.assign(decorated, { projectKey: key })
        : decorated;
    }),
    truncated,
    canEdit,
  };
}

export async function getTask(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{
  task: DecoratedTaskRow;
  canEdit: boolean;
  canClaim: boolean;
  canComment: boolean;
}> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  const canEdit = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  ).canEdit;
  const [decorated] = await decorateProjectPage(
    sql,
    auth.organizationId,
    task.projectId,
    [task],
  );
  if (!decorated) {
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  }
  return {
    task: decorated,
    canEdit,
    // Reaching here means the caller passed the project read gate — exactly
    // the requirement to comment (a READ-level action, the 0.4 posture).
    canClaim: canEdit && canClaimTask(task),
    canComment: true,
  };
}

export async function listSubtasks(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<DecoratedTaskRow[]> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  const rows = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE parent_task_id = ${taskId} AND archived_at_ms IS NULL
    ORDER BY created_at_ms ASC
  `;
  return decorateProjectPage(sql, auth.organizationId, task.projectId, rows);
}

export interface TaskActivityRow {
  id: string;
  organizationId: string;
  taskId: string;
  projectId: string;
  actorType: string;
  actorId: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: number;
}

export async function listTaskActivity(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
  limit = 100,
): Promise<TaskActivityRow[]> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  return sql<TaskActivityRow[]>`
    SELECT id::text AS id, org_id AS "organizationId",
           task_id AS "taskId", project_id AS "projectId",
           actor_type AS "actorType", actor_id AS "actorId",
           action, from_value AS "fromValue", to_value AS "toValue",
           created_at_ms::float8 AS "createdAt"
    FROM app.task_activity
    WHERE task_id = ${taskId}
    ORDER BY created_at_ms DESC, id DESC
    LIMIT ${Math.min(limit, 500)}
  `;
}

// ---------------------------------------------------------------------------
// Ops indicators (the board's working pulse / needs-answer / review chips)
// ---------------------------------------------------------------------------

const TASK_OPS_INDICATOR_CAP = 50;
const TASK_OPS_RUN_SCAN_CAP = 100;

export interface TaskOpsIndicators {
  runningTaskIds: string[];
  askingTaskIds: string[];
  pendingReviews: {
    taskId: string;
    approvalId: string;
    requestedFor?: string;
  }[];
}

function projectPendingReviews(
  rows: readonly {
    taskId: string;
    approvalId: string;
    requestedFor: string | null;
  }[],
): TaskOpsIndicators['pendingReviews'] {
  return rows.map((row) => ({
    taskId: row.taskId,
    approvalId: row.approvalId,
    ...(row.requestedFor !== null ? { requestedFor: row.requestedFor } : {}),
  }));
}

/**
 * One project's ops indicators (the 0.4 walk): tasks with a RUNNING
 * task-agent run, plus subject-linked live AUTOMATION runs (newest-first
 * bounded scan; a run parked on an unanswered, unexpired ask flips the task
 * into `askingTaskIds` — the viewer's move, not the agent's), plus the
 * pending review gates.
 */
export async function getTaskOpsIndicators(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<TaskOpsIndicators> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);

  const running = await sql<{ taskId: string }[]>`
    SELECT DISTINCT task_id AS "taskId" FROM app.project_agent_runs
    WHERE project_id = ${projectId} AND status = 'running'
    LIMIT ${TASK_OPS_INDICATOR_CAP}
  `;
  const runningTaskIds = running.map((row) => row.taskId);
  const seen = new Set(runningTaskIds);

  const askingTaskIds: string[] = [];
  const liveRuns = await sql<
    { runId: string; taskId: string | null; hasPendingAsk: boolean }[]
  >`
    SELECT r.id AS "runId", r.input -> 'task' ->> 'id' AS "taskId",
           EXISTS (
             SELECT 1 FROM app.automation_human_asks a
             WHERE a.run_id = r.id AND a.status = 'pending'
               AND a.expires_at_ms >= ${Date.now()}
           ) AS "hasPendingAsk"
    FROM app.automation_runs r
    WHERE r.org_id = ${auth.organizationId} AND r.project_id = ${projectId}
      AND r.status IN ('queued', 'running', 'waiting')
    ORDER BY r.started_at_ms DESC
    LIMIT ${TASK_OPS_RUN_SCAN_CAP}
  `;
  for (const run of liveRuns) {
    if (runningTaskIds.length >= TASK_OPS_INDICATOR_CAP) break;
    if (run.taskId === null || seen.has(run.taskId)) continue;
    runningTaskIds.push(run.taskId);
    seen.add(run.taskId);
    if (run.hasPendingAsk) askingTaskIds.push(run.taskId);
  }

  const pending = await collectPendingReviewsForProjects(
    sql,
    auth.organizationId,
    [projectId],
  );
  return {
    runningTaskIds,
    askingTaskIds,
    pendingReviews: projectPendingReviews(pending),
  };
}

/**
 * All-projects sibling: running task-agent turns + pending reviews across
 * every readable project. Automation-run indicators (and with them
 * `askingTaskIds`) are omitted — the 0.4 aggregate makes the same call.
 */
export async function getTaskOpsIndicatorsForAccessibleProjects(
  sql: Sql,
  auth: ProjectAuthContext,
): Promise<TaskOpsIndicators> {
  const projects = await listProjects(sql, auth);
  if (projects.length === 0) {
    return { runningTaskIds: [], askingTaskIds: [], pendingReviews: [] };
  }
  const projectIds = projects.map((project) => project.id);
  const running = await sql<{ taskId: string }[]>`
    SELECT DISTINCT task_id AS "taskId" FROM app.project_agent_runs
    WHERE org_id = ${auth.organizationId} AND status = 'running'
      AND project_id = ANY(${projectIds})
    LIMIT ${TASK_OPS_INDICATOR_CAP}
  `;
  const pending = await collectPendingReviewsForProjects(
    sql,
    auth.organizationId,
    projectIds,
  );
  return {
    runningTaskIds: running.map((row) => row.taskId),
    askingTaskIds: [],
    pendingReviews: projectPendingReviews(pending),
  };
}

/**
 * Every dependency edge in a project (bounded) — the board derives which
 * loaded tasks are blocked without a per-task walk.
 */
export async function listProjectDependencies(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<TaskDependencyRow[]> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  return sql<TaskDependencyRow[]>`
    SELECT blocker_task_id AS "blockerTaskId",
           blocked_task_id AS "blockedTaskId"
    FROM app.task_dependencies
    WHERE project_id = ${projectId}
    LIMIT ${TASK_BOARD_CAP}
  `;
}

export interface TaskDependencyRow {
  blockerTaskId: string;
  blockedTaskId: string;
}

/**
 * Both sides of a task's dependency graph as FULL linked task rows (the 0.4
 * wire — callers render status/title and navigate into them). Edges whose
 * linked task no longer exists drop out via the join.
 */
export async function listTaskDependencies(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ blockedBy: DecoratedTaskRow[]; blocks: DecoratedTaskRow[] }> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  const blockedBy = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE id IN (
      SELECT blocker_task_id FROM app.task_dependencies
      WHERE blocked_task_id = ${taskId}
    )
  `;
  const blocks = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE id IN (
      SELECT blocked_task_id FROM app.task_dependencies
      WHERE blocker_task_id = ${taskId}
    )
  `;
  return {
    blockedBy: await decorateProjectPage(
      sql,
      auth.organizationId,
      task.projectId,
      blockedBy,
    ),
    blocks: await decorateProjectPage(
      sql,
      auth.organizationId,
      task.projectId,
      blocks,
    ),
  };
}
