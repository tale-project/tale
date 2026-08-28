import type { Sql, TransactionSql } from 'postgres';

import { checkProjectAccess } from '../../../convex/projects/access.ts';
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
import { createAuditLog } from '../audit_logs/service.ts';
import { emitEvent } from '../events/emit.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';

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
  startDate: number | null;
  dueDate: number | null;
  statusChangedAt: number | null;
  claimedAt: number | null;
  completedAt: number | null;
  createdBy: string;
  createdByType: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

const TASK_COLUMNS = `
  id, org_id AS "organizationId", project_id AS "projectId", title,
  description, attachments, outputs, number, status, priority,
  label_ids AS "labelIds", assignee_type AS "assigneeType",
  assignee_id AS "assigneeId", reviewer_user_id AS "reviewerUserId",
  parent_task_id AS "parentTaskId", comment_count AS "commentCount", rank,
  external_system AS "externalSystem", external_id AS "externalId",
  external_url AS "externalUrl", start_date_ms::float8 AS "startDate",
  due_date_ms::float8 AS "dueDate",
  status_changed_at_ms::float8 AS "statusChangedAt",
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
}

/** Delete a label and detach it from every task carrying it. */
export async function deleteTaskLabel(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  labelId: string,
): Promise<void> {
  const rows = await tx<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.task_labels
    WHERE id = ${labelId} LIMIT 1
  `;
  const label = rows[0];
  if (!label) {
    throw new TaskError('TASK_LABEL_UNKNOWN', 'Label not found', 404);
  }
  const project = await loadProjectOrThrow(tx, label.projectId);
  assertTaskWritable(project, auth);
  await tx`
    UPDATE app.tasks SET label_ids = array_remove(label_ids, ${labelId})
    WHERE project_id = ${label.projectId} AND ${labelId} = ANY(label_ids)
  `;
  await tx`DELETE FROM app.task_labels WHERE id = ${labelId}`;
}

// ---------------------------------------------------------------------------
// Rollups, numbering, rank, activity
// ---------------------------------------------------------------------------

type TaskCountBucket = 'open' | 'done' | 'none';

function taskCountBucket(state: {
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
async function applyTaskCountTransition(
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
async function nextTaskNumber(
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
async function computeEndRank(
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

async function recordActivity(
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
  // TODO(collab): assignment notification, description mention fan-out.
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

async function hasOpenChildren(
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
  // TODO(review arc): closePendingTaskReviewOnStatusLeave + in_review request.

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
  // TODO(collab/agent runs): notify fan-out, in_progress agent-run kick.
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
}

/** Self-serve claim of an unassigned task. */
export async function claimTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);
  if (task.assigneeId !== null) {
    throw new TaskError('TASK_ALREADY_ASSIGNED', 'Task already assigned');
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
}

/** Board drag: move to (status, position) — rank between the neighbours. */
export async function moveTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    taskId: string;
    status: TaskStatus;
    beforeRank?: string;
    afterRank?: string;
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
  const rank = rankBetween(args.beforeRank, args.afterRank);
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

/** Hard delete — admin-only (0.4 contract). Subtasks are detached by FK. */
export async function deleteTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  if (!['owner', 'admin'].includes(auth.role)) {
    throw new TaskError('ROLE_FORBIDDEN', 'Admin role required', 403);
  }
  await applyTaskCountTransition(
    tx,
    task.projectId,
    taskCountBucket(task),
    'none',
  );
  await tx`DELETE FROM app.tasks WHERE id = ${taskId}`;
  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.deleted, {
      previousState: { status: task.status, title: task.title },
    }),
  );
  // TODO(storage router): delete attachment/output blobs with the task.
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
export async function listTasksByProject(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
  options: { includeArchived?: boolean } = {},
): Promise<TaskRow[]> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  const includeArchived = options.includeArchived ?? false;
  return sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE project_id = ${projectId}
      AND (${includeArchived} OR archived_at_ms IS NULL)
    ORDER BY status ASC, rank ASC
    LIMIT ${TASK_BOARD_CAP}
  `;
}

export async function getTask(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ task: TaskRow; labels: TaskLabelRow[] }> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  const labels =
    task.labelIds.length === 0
      ? []
      : await sql<TaskLabelRow[]>`
        SELECT id, org_id AS "organizationId", project_id AS "projectId",
               name, color
        FROM app.task_labels WHERE id = ANY(${task.labelIds})
      `;
  return {
    task,
    labels: labels.map((row) =>
      Object.assign(row, { color: defaultTaskLabelColor(row.name) }),
    ),
  };
}

export async function listSubtasks(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<TaskRow[]> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  return sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE parent_task_id = ${taskId} AND archived_at_ms IS NULL
    ORDER BY created_at_ms ASC
  `;
}

export interface TaskActivityRow {
  id: string;
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
    SELECT id::text AS id, actor_type AS "actorType", actor_id AS "actorId",
           action, from_value AS "fromValue", to_value AS "toValue",
           created_at_ms::float8 AS "createdAt"
    FROM app.task_activity
    WHERE task_id = ${taskId}
    ORDER BY created_at_ms DESC, id DESC
    LIMIT ${Math.min(limit, 500)}
  `;
}

export interface TaskDependencyRow {
  blockerTaskId: string;
  blockedTaskId: string;
}

export async function listTaskDependencies(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ blockedBy: TaskDependencyRow[]; blocks: TaskDependencyRow[] }> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  const blockedBy = await sql<TaskDependencyRow[]>`
    SELECT blocker_task_id AS "blockerTaskId",
           blocked_task_id AS "blockedTaskId"
    FROM app.task_dependencies WHERE blocked_task_id = ${taskId}
  `;
  const blocks = await sql<TaskDependencyRow[]>`
    SELECT blocker_task_id AS "blockerTaskId",
           blocked_task_id AS "blockedTaskId"
    FROM app.task_dependencies WHERE blocker_task_id = ${taskId}
  `;
  return { blockedBy, blocks };
}
