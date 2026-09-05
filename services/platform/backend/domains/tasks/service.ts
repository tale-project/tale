import type { Sql, TransactionSql } from 'postgres';

import {
  defaultTaskLabelColor,
  PREDEFINED_TASK_LABELS,
} from '../../../lib/shared/task-label-colors.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import {
  checkProjectAccess,
  EDITOR_ROLES,
} from '../../core/projects/access.ts';
import { canClaimTask } from '../../core/tasks/access.ts';
import {
  TASK_AUDIT_ACTIONS,
  TASK_RESOURCE_TYPE,
} from '../../core/tasks/audit_actions.ts';
import {
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
  TASK_LABELS_MAX,
  TASK_TITLE_MAX,
} from '../../core/tasks/helpers.ts';
import { initialRank, rankBetween } from '../../core/tasks/rank.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { cancelRunInTx } from '../automations/store.ts';
import {
  autoSubscribe,
  notifyTaskAssigned,
  notifyTaskReviewerAssigned,
  notifyTaskStatusChanged,
} from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import {
  listProjects,
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';
import { cancelAgentRunInTx, kickAgentRun } from './agent-runs.ts';
import {
  closePendingTaskReviewOnStatusLeave,
  collectPendingReviewsForProjects,
  requestTaskReview,
  type TaskReviewTrigger,
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

export {
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
  TASK_LABELS_MAX,
  TASK_TITLE_MAX,
} from '../../core/tasks/helpers.ts';
export const TASK_BOARD_CAP = 2000;

export class TaskError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
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

/** A project in another org answers as MISSING (the projects-domain
 * `assertSameOrg` idiom): the role matrix is org-relative, so it must never
 * run across a foreign project row — an org-A admin is nobody in org B, and
 * a 403 would confirm the foreign id exists. */
function assertTaskProjectSameOrg(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  if (project.organizationId !== auth.organizationId) {
    throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
  }
}

export function assertTaskReadable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  assertTaskProjectSameOrg(project, auth);
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
  assertTaskProjectSameOrg(project, auth);
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

/** The ONE task-by-id load — always org-scoped: a task in another org answers
 * exactly like one that does not exist (opaque 404), so a leaked id is worth
 * nothing across a tenant boundary. */
export async function loadTaskOrThrow(
  sql: Sql | TransactionSql,
  taskId: string,
  organizationId: string,
): Promise<TaskRow> {
  const rows = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE id = ${taskId} AND org_id = ${organizationId} LIMIT 1
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

export interface AssigneeRef {
  assigneeType: TaskAssigneeType;
  assigneeId: string;
}

/**
 * Whether writing `assignee` onto `task` changes who holds it — the ONE rule
 * behind the picker's (`assignTask`) live-run transfer gate. A same-assignee re-select and clearing an already-unassigned
 * task are not transfers.
 */
export function assigneeChanges(
  task: Pick<TaskRow, 'assigneeType' | 'assigneeId'>,
  assignee: AssigneeRef | null,
): boolean {
  return (
    task.assigneeId !== (assignee?.assigneeId ?? null) ||
    task.assigneeType !== (assignee?.assigneeType ?? null)
  );
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
// The settle seams — what every status / assignee door does after its write
// ---------------------------------------------------------------------------

/**
 * The post-write step EVERY status door shares: the picker, the board drag,
 * the bulk bar, the mention-kick hand-off, the agent's park and the review
 * decision all flip `app.tasks.status` their own way, then land here — the
 * rollup transition, the activity line (which is also the board's hint), the
 * audit row, the `task.status_changed` platform event, and the subscribers'
 * bell. One seam, so no door can drift: the drag used to skip the event and
 * the bell while the picker fired both.
 *
 * `task` is the row as it stood BEFORE the write (its old status and
 * archive state drive the rollup delta and the from→to copy).
 */
export async function settleTaskStatusChange(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    toStatus: TaskStatus;
    actorType: 'user' | 'agent';
    actorId: string;
    /** The human doors' audit row — the auth context carries the actor's
     * email. The kick hand-off and the agent lanes carry none. */
    audit?: ProjectAuthContext;
    /** `false` when the door already told every subscriber what happened
     * in its own words (the review decision's resolved bell) — a second
     * "status changed" row would be noise. */
    bell?: boolean;
  },
): Promise<void> {
  const { task, toStatus } = args;
  await applyTaskCountTransition(
    tx,
    task.projectId,
    taskCountBucket(task),
    taskCountBucket({ status: toStatus, archivedAt: task.archivedAt }),
  );
  await recordActivity(tx, {
    task,
    actorType: args.actorType,
    actorId: args.actorId,
    action: 'status.changed',
    fromValue: task.status,
    toValue: toStatus,
  });
  if (args.audit !== undefined) {
    await createAuditLog(
      tx,
      taskAudit(args.audit, task, TASK_AUDIT_ACTIONS.statusChanged, {
        previousState: { status: task.status },
        newState: { status: toStatus },
      }),
    );
  }
  // The platform event is the HUMAN doors' — every gesture a person makes
  // on the board or in the sheet fires the org's `task.status_changed`
  // triggers alike. The agent lane stays event-less on purpose: dispatch
  // cannot yet tell a run's own flips apart from a person's (nothing
  // passes `dispatchAutomationEvent` its 'automation' origin), so an
  // automation reacting to the event by moving the card would re-trigger
  // itself. That plumbing is the precondition for turning it on.
  if (args.actorType === 'user') {
    await emitEvent(tx, {
      organizationId: task.organizationId,
      eventType: 'task.status_changed',
      eventData: {
        taskId: task.id,
        projectId: task.projectId,
        fromStatus: task.status,
        toStatus,
        actorType: 'user',
        actorId: args.actorId,
      },
    });
  }
  if (args.bell !== false) {
    await notifyTaskStatusChanged(tx, {
      task,
      fromStatus: task.status,
      toStatus,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
}

/**
 * The post-write step every ASSIGNEE door shares (the assign verb and the
 * bulk bar): the activity line, the audit row, and the assignment fan-out —
 * the new human assignee is subscribed and belled, the one who lost the
 * work is told. `task` is the row BEFORE the write.
 */
export async function settleTaskAssigneeChange(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    assignee: AssigneeRef | null;
    auth: ProjectAuthContext;
  },
): Promise<void> {
  const { task, assignee, auth } = args;
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'assignee.changed',
    ...(task.assigneeId !== null ? { fromValue: task.assigneeId } : {}),
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
    const parent = await loadTaskOrThrow(
      tx,
      args.parentTaskId,
      auth.organizationId,
    );
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
  const task = await loadTaskOrThrow(tx, args.taskId, auth.organizationId);
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
  // A NEW designee (not a clear, not a re-select) is about to be subscribed
  // and belled: only a live member of THIS org can be on the hook — the
  // picker offers members only, so a miss is a stale or hand-built request,
  // and a disabled account cannot review.
  const designatedReviewer =
    args.reviewerUserId !== undefined &&
    reviewerUserId !== null &&
    reviewerUserId !== task.reviewerUserId
      ? reviewerUserId
      : null;
  if (designatedReviewer !== null) {
    const member = await findOrganizationMember(
      tx,
      auth.organizationId,
      designatedReviewer,
    );
    if (member === null || member.role === 'disabled') {
      throw new TaskError(
        'TASK_REVIEWER_INVALID',
        'The reviewer must be an active member of this organization',
      );
    }
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
  if (designatedReviewer !== null) {
    // The designee owns the gate from now on: they follow the task (its
    // progress, not just the request moment) and get the heads-up bell —
    // "you're on the hook for this one". The actionable request + email
    // follow when the card reaches In review. Before this, the column was
    // written and nobody was told.
    await autoSubscribe(tx, {
      organizationId: auth.organizationId,
      taskId: task.id,
      subscriberType: 'user',
      subscriberId: designatedReviewer,
      reason: 'reviewer',
    });
    await notifyTaskReviewerAssigned(tx, {
      organizationId: auth.organizationId,
      task: { id: task.id, projectId: task.projectId, title },
      reviewerUserId: designatedReviewer,
      actorUserId: auth.userId,
    });
  }
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
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
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
  await settleTaskStatusChange(tx, {
    task,
    toStatus: status,
    actorType: 'user',
    actorId: auth.userId,
    audit: auth,
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
}

/**
 * TRUSTED agent-side CREATE — the `task_create` workspace tool's lower half.
 * The dispatch already resolved which project this session may write to
 * (`resolveSessionActionContext`), so there is no role matrix here; what stays
 * is the task-ops shape: an agent files into the neutral inbox columns only,
 * mints the labels it names (an agent cannot open the label catalog itself),
 * and may subtask a ROOT card but never a subtask — decomposition is one level
 * deep. Attribution is the binding actor (`created_by_type: 'agent'`), and the
 * agent does NOT auto-subscribe: it is not a person who wants the bells.
 */
export async function agentCreateTaskTrusted(
  tx: TransactionSql,
  args: {
    organizationId: string;
    actorId: string;
    projectId: string;
    title: string;
    description?: string;
    /** Neutral inbox columns only — the bridge narrows before calling. */
    status?: Extract<TaskStatus, 'backlog' | 'todo'>;
    priority?: TaskPriority;
    labels?: string[];
    parentTaskId?: string;
  },
): Promise<{ taskId: string }> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  // A project in ANOTHER org reads as missing, never as forbidden: the tool
  // takes an opaque id, and two different refusals would tell a bound run
  // whether a foreign id exists.
  if (project.organizationId !== args.organizationId) {
    throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
  }
  const title = validateTitle(args.title);
  const description = validateDescription(args.description);
  const status = args.status ?? 'backlog';

  if (args.parentTaskId !== undefined) {
    // Org-scoped load: a parent id from another org reads as missing.
    const parent = await loadTaskOrThrow(
      tx,
      args.parentTaskId,
      args.organizationId,
    );
    if (parent.projectId !== args.projectId) {
      throw new TaskError('TASK_PARENT_PROJECT_MISMATCH', 'Parent mismatch');
    }
    if (parent.archivedAt !== null) {
      throw new TaskError('TASK_PARENT_ARCHIVED', 'Parent archived');
    }
    if (parent.parentTaskId !== null) {
      throw new TaskError('TASK_DEPTH_EXCEEDED', 'Subtasks do not nest');
    }
  }

  const labelIds =
    (await resolveProjectLabels(tx, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      names: args.labels,
      createdBy: args.actorId,
      createIfMissing: true,
    })) ?? [];
  const now = Date.now();
  const rank = await computeEndRank(tx, args.projectId, status);
  const number = await nextTaskNumber(tx, args.projectId);
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.tasks (
      org_id, project_id, title, description, status, priority, label_ids,
      parent_task_id, rank, number, created_by, created_by_type,
      created_at_ms, updated_at_ms, status_changed_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.projectId}, ${title},
      ${description ?? null}, ${status}, ${args.priority ?? null}, ${labelIds},
      ${args.parentTaskId ?? null}, ${rank}, ${number}, ${args.actorId},
      'agent', ${now}, ${now}, ${now}
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
      organizationId: args.organizationId,
      projectId: args.projectId,
    },
    actorType: 'agent',
    actorId: args.actorId,
    action: 'created',
    toValue: status,
  });
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actorId,
    actorType: 'api',
    action: TASK_AUDIT_ACTIONS.created,
    category: 'data',
    resourceType: TASK_RESOURCE_TYPE,
    resourceId: taskId,
    resourceName: title,
    metadata: {
      viaAgent: true,
      projectId: args.projectId,
      parentTaskId: args.parentTaskId ?? null,
    },
    status: 'success',
  });
  await emitEvent(tx, {
    organizationId: args.organizationId,
    eventType: 'task.created',
    eventData: {
      taskId,
      projectId: args.projectId,
      actorType: 'agent',
      actorId: args.actorId,
    },
  });
  return { taskId };
}

/**
 * TRUSTED agent-side status flip — the settle's park to `in_review` (and the
 * failure paths that leave `in_progress` alone). The turn host already
 * resolved authority (the run belongs to the agent); this is the lower half:
 * status + rank + rollup + activity, attributed to the agent actor, plus the
 * review-gate mint (task_review row + reviewer bell) whenever the park lands
 * at `in_review`.
 */
export async function agentUpdateTaskStatusTrusted(
  tx: TransactionSql,
  args: {
    organizationId: string;
    actorId: string;
    taskId: string;
    status: TaskStatus;
    /** The settle park to `in_review` names its run: the review is minted
     * in the SAME transaction as the flip, keyed on the runId (find-or-
     * insert — the burned-claim replay never double-mints). Lanes without a
     * run key (the agent tool, the workflow native) still mint; see
     * `mintReview`. */
    review?: { runId: string };
  },
  // `reason` is a CODE, not prose: the workspace-tool bridge branches on
  // `AGENTS_CANNOT_COMPLETE` to tell the agent to park at `in_review`
  // instead, and the connector native renders each code as a sentence.
): Promise<{ ok: boolean; reason?: string }> {
  // Org-scoped load: a task in another org answers as missing (opaque 404
  // through the tool bridge) — one refusal shape for foreign and garbage ids.
  const task = await loadTaskOrThrow(tx, args.taskId, args.organizationId);
  // Reaching `in_review` IS the request for review, whichever trusted lane
  // parked the card: the settle carries its run key; the agent's own
  // `task_update_status` tool and the workflow `task.update_status` native
  // carry none, so the key is the task's LIVE run when one exists (the
  // settle's later park then finds this same row instead of superseding it
  // with a second bell) and an automation-keyed row otherwise. Idempotent.
  const mintReview = async (): Promise<void> => {
    if (args.status !== 'in_review') return;
    const fresh = await loadTaskOrThrow(tx, args.taskId, args.organizationId);
    if (fresh.status !== 'in_review') return;
    let trigger: TaskReviewTrigger;
    if (args.review !== undefined) {
      trigger = { kind: 'agent_run', runId: args.review.runId };
    } else {
      const live = await tx<{ id: string }[]>`
        SELECT id FROM app.project_agent_runs
        WHERE task_id = ${args.taskId} AND org_id = ${args.organizationId}
          AND status IN ('queued', 'running')
        ORDER BY started_at_ms DESC
        LIMIT 1
      `;
      trigger =
        live[0] !== undefined
          ? { kind: 'agent_run', runId: live[0].id }
          : { kind: 'automation' };
    }
    await requestTaskReview(tx, { task: fresh, trigger });
  };
  if (task.status === args.status) {
    await mintReview();
    return { ok: true };
  }
  // `done` is the REVIEW GATE's to give: an agent or an automation parks
  // finished work at `in_review` and a person certifies it. Cancelling is a
  // different act — abandoning work rather than certifying it — and the
  // automation lane has always been allowed to make it ("this ticket is
  // obsolete, close the card"), so only completion is reserved here.
  if (args.status === 'done') {
    return { ok: false, reason: 'AGENTS_CANNOT_COMPLETE' };
  }
  // Same bound the human writer keeps: nothing goes terminal over children
  // that are still open, or the board loses them.
  if (
    TERMINAL_STATUSES.has(args.status) &&
    (await hasOpenChildren(tx, args.taskId))
  ) {
    return { ok: false, reason: 'TASK_HAS_OPEN_SUBTASKS' };
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
  // Terminal keeps its original completion stamp on a re-close and loses it
  // on the way back out — the human writer's rule, so the two lanes agree.
  const completedAt = TERMINAL_STATUSES.has(args.status)
    ? (task.completedAt ?? now)
    : null;
  await tx`
    UPDATE app.tasks SET
      status = ${args.status}, rank = ${rank}, completed_at_ms = ${completedAt},
      updated_at_ms = ${now}, status_changed_at_ms = ${now}
    WHERE id = ${args.taskId}
  `;
  await settleTaskStatusChange(tx, {
    task,
    toStatus: args.status,
    actorType: 'agent',
    actorId: args.actorId,
  });
  await mintReview();
  return { ok: true };
}

/**
 * Hand the card to In progress as the lower half of a KICK — the shared
 * write for every "kicking a run moves the card" lane that cannot route
 * through `updateTaskStatus` (no full status-writer context, or the kick
 * carries feedback the status writer's own kick would drop): the steer-miss
 * mention kick and the comment-mention dispatcher. Withdraws a pending
 * review gate on the way out (every leave closes it), clears a terminal
 * `completedAt`, and records the move as the USER's act — the kick is their
 * gesture. Returns whether the card actually moved.
 */
export async function handTaskToInProgressForKick(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string; userId: string },
): Promise<boolean> {
  const fresh = await loadTaskOrThrow(tx, args.taskId, args.organizationId);
  if (fresh.status === 'in_progress') return false;
  await closePendingTaskReviewOnStatusLeave(tx, {
    task: fresh,
    toStatus: 'in_progress',
    actor: { kind: 'user', userId: args.userId },
  });
  const now = Date.now();
  const rank = await computeEndRank(tx, fresh.projectId, 'in_progress');
  await tx`
    UPDATE app.tasks SET
      status = 'in_progress', rank = ${rank}, completed_at_ms = NULL,
      status_changed_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${fresh.id}
  `;
  // The kick is the person's gesture, so the card's move bells and fires
  // triggers like their drag would; the lane carries no auth context, so
  // (as before) no audit row.
  await settleTaskStatusChange(tx, {
    task: fresh,
    toStatus: 'in_progress',
    actorType: 'user',
    actorId: args.userId,
  });
  return true;
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
  const task = await loadTaskOrThrow(tx, args.taskId, args.organizationId);
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
  const task = await loadTaskOrThrow(tx, args.taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);

  const assignee = normalizeAssignee(args);
  await assertAssigneeValid(tx, { project, auth, assignee });
  // A live run holds the task for its current worker: transferring it
  // mid-flight would leave the old agent driving (settle comments, the
  // in_review park) a card that now shows someone else's name, and "Run
  // agent" answering already_running for the wrong agent. The refusal
  // names itself — the picker cancels the run first, then reassigns (its
  // confirmed-handoff flow).
  if (assigneeChanges(task, assignee) && (await taskHasLiveRun(tx, task))) {
    throw new TaskError(
      'TASK_HAS_LIVE_RUN',
      'A live run holds this task; cancel it before reassigning',
      409,
    );
  }

  await tx`
    UPDATE app.tasks SET
      assignee_type = ${assignee?.assigneeType ?? null},
      assignee_id = ${assignee?.assigneeId ?? null},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.taskId}
  `;
  await settleTaskAssigneeChange(tx, { task, assignee, auth });
}

/** Self-serve claim of an unassigned task. */
export async function claimTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ claimed: boolean; reason?: string }> {
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
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
  const task = await loadTaskOrThrow(tx, args.taskId, auth.organizationId);
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
    // The drag is the same status door as the picker: it bells the
    // subscribers and fires the org's triggers through the shared seam.
    await settleTaskStatusChange(tx, {
      task,
      toStatus: args.status,
      actorType: 'user',
      actorId: auth.userId,
      audit: auth,
    });
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
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
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
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
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
 * Every blob ref a set of task rows holds — the `fileId` of each
 * attachment/output element (the `s3:` ref both columns carry, the same
 * vocabulary `files/access.ts` reads back), de-duplicated in first-seen
 * order. Malformed elements are skipped: a hard delete must never fail on a
 * row it is about to remove.
 */
export function collectTaskBlobRefs(
  rows: ReadonlyArray<{ attachments: unknown; outputs: unknown }>,
): string[] {
  const refs = new Set<string>();
  for (const row of rows) {
    for (const column of [row.attachments, row.outputs]) {
      if (!Array.isArray(column)) continue;
      for (const element of column) {
        if (
          element !== null &&
          typeof element === 'object' &&
          'fileId' in element &&
          typeof element.fileId === 'string' &&
          element.fileId !== ''
        ) {
          refs.add(element.fileId);
        }
      }
    }
  }
  return [...refs];
}

/**
 * Hard delete — admin-only (0.4 contract). Deletes the WHOLE SUBTREE
 * (subtasks recursively) with each task's discussion thread; returns how
 * many children went with it (the confirm dialog names the count).
 *
 * Nothing the subtree owned outlives it: its live runs are cancelled in
 * this transaction (the agent run through the ledgered cancel door, so the
 * provenance entry lands before the FK cascade takes the row and the turn
 * host reaps the exec as an orphan; a bound automation run through its own
 * terminal door), and its attachment/output blobs are handed to the shared
 * ref-release seam — the tasks' unbound file rows are trashed here and the
 * durable `knowledge.release_refs` job deletes the bytes after commit,
 * keeping any ref another task, document or file row still holds.
 */
export async function deleteTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ deletedChildCount: number }> {
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
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
      attachments: unknown;
      outputs: unknown;
    }[]
  >`
    WITH RECURSIVE tree AS (
      SELECT id, status, archived_at_ms, discussion_thread_id, attachments,
             outputs, 0 AS depth
      FROM app.tasks WHERE id = ${taskId}
      UNION ALL
      SELECT t.id, t.status, t.archived_at_ms, t.discussion_thread_id,
             t.attachments, t.outputs, tree.depth + 1
      FROM app.tasks t JOIN tree ON t.parent_task_id = tree.id
      WHERE tree.depth < 32
    )
    SELECT id, status, archived_at_ms::float8 AS "archivedAt",
           discussion_thread_id AS "discussionThreadId", attachments, outputs
    FROM tree
  `;
  const ids = tree.map((row) => row.id);

  // Live runs die WITH their tasks, not after them. The agent run's row
  // would FK-cascade away mid-turn, leaving the sandbox turn executing with
  // nowhere to land and no provenance entry; cancelling it here writes the
  // ledger row first, and the turn host's orphan check reaps the exec. A
  // bound automation run keeps its own terminal contract (audit row,
  // sessions released).
  let cancelledRunCount = 0;
  const liveAgentRuns = await tx<{ id: string; taskId: string }[]>`
    SELECT id, task_id AS "taskId" FROM app.project_agent_runs
    WHERE org_id = ${auth.organizationId} AND task_id = ANY(${ids})
      AND status IN ('queued', 'running')
  `;
  for (const run of liveAgentRuns) {
    const cancelled = await cancelAgentRunInTx(tx, {
      organizationId: auth.organizationId,
      runId: run.id,
      taskId: run.taskId,
    });
    if (cancelled) cancelledRunCount += 1;
  }
  const liveAutomationRuns = await tx<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE org_id = ${auth.organizationId} AND project_id = ${task.projectId}
      AND status IN ('queued', 'running', 'waiting')
      AND input -> 'task' ->> 'id' = ANY(${ids})
  `;
  for (const run of liveAutomationRuns) {
    const outcome = await cancelRunInTx(tx, auth.organizationId, run.id);
    if (outcome.cancelled) cancelledRunCount += 1;
  }

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
  // Pending approvals that named these tasks die with them. Leaving them
  // would show a reviewer an inbox row for work that no longer exists —
  // undecidable, because every decision path resolves the task first. They
  // are REJECTED rather than deleted so the audit trail keeps the fact that
  // a review was once requested (0.4 orphaned them; this is the fix, not a
  // port of the shortcoming).
  await tx`
    UPDATE app.approvals SET
      status = 'rejected', reviewed_at_ms = ${Date.now()},
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('closedReason', 'task_deleted')
    WHERE org_id = ${auth.organizationId} AND status = 'pending'
      AND (
        (resource_type IN ('task_review', 'document_record_review')
          AND resource_id = ANY(${ids}))
        OR metadata->>'taskId' = ANY(${ids})
      )
  `;
  await tx`DELETE FROM app.tasks WHERE id = ANY(${ids})`;

  // Blob reclaim through the shared release seam. A ref some SURVIVING task
  // still lists stays (the same deliverable can sit on two cards); for the
  // rest, the tasks' own unbound file rows are trashed so the release sees
  // them dead, and the durable job deletes the bytes after commit — network
  // I/O never runs inside this transaction, and the release re-checks
  // liveness itself (a document or a chat thread holding the same ref keeps
  // its bytes). Before this, every deleted task leaked its files for good.
  const refs = collectTaskBlobRefs(tree);
  let releasedRefs: string[] = [];
  if (refs.length > 0) {
    const orphaned = await tx<{ ref: string }[]>`
      SELECT r.ref FROM unnest(${refs}::text[]) AS r(ref)
      WHERE NOT EXISTS (
        SELECT 1 FROM app.tasks t
        WHERE t.org_id = ${auth.organizationId}
          AND (t.outputs @> jsonb_build_array(jsonb_build_object('fileId', r.ref))
               OR t.attachments
                  @> jsonb_build_array(jsonb_build_object('fileId', r.ref)))
      )
    `;
    releasedRefs = orphaned.map((row) => row.ref);
    if (releasedRefs.length > 0) {
      await tx`
        UPDATE app.file_metadata SET
          lifecycle_status = 'trashed', status_changed_at_ms = ${Date.now()}
        WHERE org_id = ${auth.organizationId}
          AND storage_ref = ANY(${releasedRefs})
          AND document_id IS NULL AND thread_id IS NULL
          AND conversation_id IS NULL
          AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
      `;
      await addJobInTx(tx, 'knowledge.release_refs', {
        organizationId: auth.organizationId,
        refs: releasedRefs,
      });
    }
  }

  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.deleted, {
      previousState: { status: task.status, title: task.title },
      metadata: {
        deletedChildCount: ids.length - 1,
        cancelledRunCount,
        releasedBlobRefCount: releasedRefs.length,
      },
    }),
  );
  // Deletes leave no activity row (the task is gone) — hint explicitly.
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: taskId,
  });
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
  const blocker = await loadTaskOrThrow(
    tx,
    args.blockerTaskId,
    auth.organizationId,
  );
  const blocked = await loadTaskOrThrow(
    tx,
    args.blockedTaskId,
    auth.organizationId,
  );
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
  const blocked = await loadTaskOrThrow(
    tx,
    args.blockedTaskId,
    auth.organizationId,
  );
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

/** How many cards one `task_find` may walk. The tool answers a working set,
 * not a board: an agent that needs more should filter harder. */
export const AGENT_TASK_LIST_CAP = 200;

/**
 * The `task_find` read — undecorated rows for an agent, NOT a board page.
 * Authority is resolved before this call (`resolveSessionActionContext`), so
 * the project set arrives as an argument: one project for a project-bound run,
 * its automation's bound set for an org-wide one, and nothing at all for a
 * truly org-level run, which reads the whole organization. Labels and folder
 * facts are skipped — the model reads titles and status, not chips.
 */
export async function listTasksForAgent(
  sql: Sql,
  args: {
    organizationId: string;
    projectId?: string;
    projectIds?: string[];
    status?: TaskStatus;
    assigneeId?: string;
    includeArchived?: boolean;
  },
): Promise<TaskRow[]> {
  // One named project wins over the bound set — the caller already checked it
  // is inside that set, and an empty set would otherwise read as org-wide.
  const scoped =
    args.projectId !== undefined ? [args.projectId] : (args.projectIds ?? null);
  const filters: TaskListFilters = {
    ...(args.includeArchived === true ? { includeArchived: true } : {}),
    ...(args.status !== undefined ? { status: args.status } : {}),
    ...(args.assigneeId !== undefined ? { assigneeId: args.assigneeId } : {}),
  };
  const rows = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE org_id = ${args.organizationId}
      AND (${scoped === null} OR project_id = ANY(${scoped ?? []}))
      AND ${boardFilterClause(sql, filters)}
    ORDER BY status ASC, rank ASC
    LIMIT ${AGENT_TASK_LIST_CAP}
  `;
  return [...rows];
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
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
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
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
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
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
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
// Search (the palette + the tasks toolbar)
// ---------------------------------------------------------------------------

const SEARCH_MAX_RESULTS = 25;
const SEARCH_SNIPPET_MAX = 600;

export interface TaskSearchHit {
  taskId: string;
  projectId: string;
  title: string;
  snippet: string;
  updatedAt: number;
  number?: number;
  projectKey?: string;
}

/**
 * Token-AND search over the field haystack (title + description +
 * externalId + `KEY-number`), with a comment-body fallback for tasks whose
 * fields don't match (the 0.4 walk; unbounded here — SQL searches the whole
 * visible set instead of the newest-80 window Convex's read limits forced).
 */
export async function searchTasks(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { query: string; projectId?: string },
): Promise<TaskSearchHit[]> {
  const tokens = args.query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [];
  const patterns = tokens.map(
    (token) => `%${token.replaceAll(/([%_\\])/g, String.raw`\$1`)}%`,
  );

  let projectIds: string[];
  const projectKeys = new Map<string, string | null>();
  if (args.projectId !== undefined) {
    const project = await loadProjectOrThrow(sql, args.projectId);
    if (project.archivedAt !== null) return [];
    assertTaskReadable(project, auth);
    projectIds = [project.id];
    projectKeys.set(project.id, project.key);
  } else {
    const projects = await listProjects(sql, auth);
    projectIds = projects.map((project) => project.id);
    for (const project of projects) projectKeys.set(project.id, project.key);
  }
  if (projectIds.length === 0) return [];

  interface FieldHit {
    taskId: string;
    projectId: string;
    title: string;
    description: string | null;
    updatedAt: number;
    number: number | null;
  }
  const fieldHits = await sql<FieldHit[]>`
    SELECT t.id AS "taskId", t.project_id AS "projectId", t.title,
           t.description, t.updated_at_ms::float8 AS "updatedAt", t.number
    FROM app.tasks t
    JOIN app.projects p ON p.id = t.project_id
    WHERE t.org_id = ${auth.organizationId}
      AND t.project_id = ANY(${projectIds})
      AND t.archived_at_ms IS NULL
      AND lower(
        t.title || ' ' || coalesce(t.description, '') || ' ' ||
        coalesce(t.external_id, '') || ' ' ||
        coalesce(p.key || '-' || t.number::text, '')
      ) LIKE ALL(${patterns})
    ORDER BY t.updated_at_ms DESC
    LIMIT ${SEARCH_MAX_RESULTS}
  `;
  const seen = new Set(fieldHits.map((hit) => hit.taskId));

  const toHit = (hit: FieldHit, snippetSource: string): TaskSearchHit => {
    const key = projectKeys.get(hit.projectId) ?? null;
    const row: TaskSearchHit = {
      taskId: hit.taskId,
      projectId: hit.projectId,
      title: hit.title,
      snippet: snippetSource.trim().slice(0, SEARCH_SNIPPET_MAX),
      updatedAt: hit.updatedAt,
    };
    if (hit.number !== null) row.number = hit.number;
    if (key !== null) row.projectKey = key;
    return row;
  };
  const results: TaskSearchHit[] = fieldHits.map((hit) =>
    toHit(hit, hit.description ?? hit.title),
  );

  if (results.length < SEARCH_MAX_RESULTS) {
    const commentHits = await sql<(FieldHit & { body: string })[]>`
      SELECT DISTINCT ON (t.updated_at_ms, t.id)
             t.id AS "taskId", t.project_id AS "projectId", t.title,
             t.description, t.updated_at_ms::float8 AS "updatedAt", t.number,
             m.text AS body
      FROM app.task_discussion_message_meta meta
      JOIN app.messages m ON m.id = meta.message_id
      JOIN app.tasks t ON t.id = meta.task_id
      WHERE meta.org_id = ${auth.organizationId}
        AND t.project_id = ANY(${projectIds})
        AND t.archived_at_ms IS NULL
        AND lower(coalesce(m.text, '')) LIKE ALL(${patterns})
      ORDER BY t.updated_at_ms DESC, t.id, m.created_at_ms DESC
      LIMIT ${SEARCH_MAX_RESULTS}
    `;
    for (const hit of commentHits) {
      if (results.length >= SEARCH_MAX_RESULTS) break;
      if (seen.has(hit.taskId)) continue;
      seen.add(hit.taskId);
      results.push(toHit(hit, hit.body));
    }
    results.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mention trigger preview (the composers' @-mention hint)
// ---------------------------------------------------------------------------

export interface MentionTriggerPreviewRow {
  slug: string;
  willTrigger: boolean;
  reason: 'ok' | 'not_mentionable' | 'pack_disabled' | 'breaker_paused';
}

/**
 * Per mentioned agent slug: would saving put it to work — and if not, why.
 * The 0.4 gate set minus the run-breaker leg (`breaker_paused` stays in the
 * union for shape stability; the pg task row has no pause bookkeeping yet).
 */
export async function mentionTriggerPreview(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { taskId?: string; projectId?: string; slugs: string[] },
): Promise<MentionTriggerPreviewRow[]> {
  const slugs = [...new Set(args.slugs)].slice(0, 10);
  if (slugs.length === 0) return [];

  let project: ProjectRow;
  if (args.taskId !== undefined) {
    const task = await loadTaskOrThrow(sql, args.taskId, auth.organizationId);
    project = await loadProjectOrThrow(sql, task.projectId);
  } else if (args.projectId !== undefined) {
    project = await loadProjectOrThrow(sql, args.projectId);
  } else {
    throw new TaskError('INVALID_ARGUMENTS', 'taskId or projectId required');
  }
  assertTaskReadable(project, auth);

  const restricted = (project.agentMode ?? 'all') === 'restricted';
  const allowed = new Set(project.allowedAgentSlugs);
  const automationPolicy = await readGovernancePolicyForOrg(
    sql,
    auth.organizationId,
    'task_automation',
  );
  const packEnabled = automationPolicy?.enabled !== false;

  return slugs.map((slug) => {
    if (restricted && !allowed.has(slug)) {
      return { slug, willTrigger: false, reason: 'not_mentionable' as const };
    }
    if (!packEnabled) {
      return { slug, willTrigger: false, reason: 'pack_disabled' as const };
    }
    return { slug, willTrigger: true, reason: 'ok' as const };
  });
}

/** Whether any run family holds this task live (agent turn or automation). */
async function taskHasLiveRun(
  tx: TransactionSql,
  task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>,
): Promise<boolean> {
  const agent = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE task_id = ${task.id} AND status IN ('queued', 'running')
    LIMIT 1
  `;
  if (agent.length > 0) return true;
  return taskHasLiveAutomationRun(tx, task);
}

/** Whether a live AUTOMATION run holds this task (subject-linked, the 0.4
 * `findLiveAutomationRunForTask` probe) — the automation half of
 * `taskHasLiveRun`, exported for lanes that treat the two families
 * differently (the comment-mention dispatcher steers an agent run but
 * yields entirely to an automation). */
export async function taskHasLiveAutomationRun(
  tx: TransactionSql,
  task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>,
): Promise<boolean> {
  const automation = await tx<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE org_id = ${task.organizationId} AND project_id = ${task.projectId}
      AND status IN ('queued', 'running', 'waiting')
      AND input -> 'task' ->> 'id' = ${task.id}
    LIMIT 1
  `;
  return automation.length > 0;
}

/**
 * The manual "Run agent" kick: the task's ASSIGNED agent starts (or reuses)
 * a run AND the card moves to In progress as the caller's own status write
 * — a contested/ineligible state answers as DATA (the 0.4 wire).
 */
export async function startTaskAgentRunManual(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ started: boolean; reason?: string }> {
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertTaskNotArchived(task);
  if (task.assigneeType !== 'agent' || task.assigneeId === null) {
    return { started: false, reason: 'no_agent_assignee' };
  }
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
  if (!agent) {
    return { started: false, reason: 'agent_missing' };
  }
  // The board verb IS the interface (the 0.4 rule): kicking the run moves
  // the card, and the move is the CALLER's own status write. A task not yet
  // at `in_progress` routes through `updateTaskStatus`, whose choreography
  // kicks the queued run inside this same transaction — the board never
  // shows a To-do agent task with a live run grinding behind it. The
  // live-run probe answers `already_running` BEFORE any move (0.4's guard
  // order), so a second click never reshuffles the board.
  if (task.status !== 'in_progress') {
    const live = await tx<{ id: string }[]>`
      SELECT id FROM app.project_agent_runs
      WHERE task_id = ${taskId} AND status IN ('queued', 'running')
      LIMIT 1
    `;
    if (live.length > 0) {
      return { started: false, reason: 'already_running' };
    }
    await updateTaskStatus(tx, auth, taskId, 'in_progress');
    return { started: true };
  }
  const kicked = await kickAgentRun(tx, {
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
  if (kicked.reused) {
    return { started: false, reason: 'already_running' };
  }
  return { started: true };
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
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
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
