import { markRetryQueueKey } from '@tale/shared/db/serializable';
import { isEpochMs } from '@tale/shared/schemas/epoch-ms';
import type { TaskExternalIssue } from '@tale/shared/schemas/task-external-issue';
import {
  projectTaskReviewerFromId,
  taskReviewerFromIds,
  type SetTaskReviewerInput,
  type TaskReviewRecipient,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  isAgentRunWaitingReason,
  type AgentRunWaitingReason,
} from '../../../lib/shared/agent-run-waiting.ts';
import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import {
  defaultTaskLabelColor,
  PREDEFINED_TASK_LABELS,
} from '../../../lib/shared/task-label-colors.ts';
import { compareRank } from '../../../lib/shared/task-rank-order.ts';
import {
  parseTaskRepeat,
  sameTaskRepeat,
  type TaskRepeat,
} from '../../../lib/shared/task-repeat.ts';
import { findActingMember } from '../../auth/membership.ts';
import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import {
  checkProjectAccess,
  EDITOR_ROLES,
} from '../../core/projects/access.ts';
import {
  canWorkTask,
  TASK_ANCESTRY_DEPTH_MAX,
  type TaskAccess,
  taskAccessFrom,
  type TaskOwnership,
} from '../../core/tasks/access.ts';
import {
  TASK_AUDIT_ACTIONS,
  TASK_RESOURCE_TYPE,
} from '../../core/tasks/audit_actions.ts';
import {
  TASK_ATTACHMENTS_MAX,
  TASK_DESCRIPTION_MAX,
  taskDescriptionRefusal,
  taskLabelCountRefusal,
  taskLabelNameRefusal,
  taskTitleRefusal,
} from '../../core/tasks/helpers.ts';
import {
  cutTaskText,
  descriptionMentionMode,
  editIntroducesMentions,
  MENTION_URL_SQL_PATTERN,
  type MentionSource,
  type ResolvedMention,
  taskMentionPlainText,
} from '../../core/tasks/mentions.ts';
import { TASK_PRIORITIES } from '../../core/tasks/metadata.ts';
import { initialRank, rankBetween } from '../../core/tasks/rank.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  auditChainQueueKey,
  createAuditLog,
  lockAuditChain,
} from '../audit_logs/service.ts';
import {
  currentMentionNames,
  prepareSurfaceText,
} from '../collab/mention-directory.ts';
import {
  autoSubscribe,
  dismissReviewerAssignedNotifications,
  notifyTaskAssigned,
  notifyTaskMentions,
  notifyTaskReviewerAssigned,
  notifyTaskStatusChanged,
} from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import { firstForeignUpload } from '../files/upload-intents.ts';
import {
  getProjectAuthContext,
  listProjects,
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';
import { readStandardAgentAvailability } from '../projects/standard-agent.ts';
import {
  agentRunWorkerNumber,
  cancelAgentRunInTx,
  isStandardAgentRefusal,
  kickAgentRun,
  parkedRunSql,
  parkedWaitingReasonSql,
  withdrawWaitingAgentRunInTx,
} from './agent-runs.ts';
import { assertAutomationForTask } from './automation-access.ts';
import { openTaskBlockerIds } from './dependencies.ts';
import { TaskError } from './errors.ts';
import {
  assertTaskCanRepeat,
  createNextRepeatCopy,
  endRepeatForAutomationOwner,
  type TaskRepeatCopy,
  validateTaskRepeat,
} from './repeat.ts';
import { releaseUnlistedTaskBlobRefs, retireTasksInTx } from './retire.ts';
import {
  agentReviewerEligibility,
  closePendingTaskReviewOnStatusLeave,
  collectPendingReviewsForProjects,
  getPendingReviewForTask,
  replacePendingTaskReviewer,
  requestTaskReview,
  retargetPendingTaskReview,
  reviewerEligibility,
  type TaskReviewTrigger,
} from './reviews.ts';
import { scheduleMayActInProject } from './run-authority.ts';
import { lockTaskRunStart, mentionAutomationEnabled } from './run-start.ts';
import { assertTaskSourceThreadReadable } from './source-thread.ts';

/**
 * Tasks domain, Tier A — the task board core: CRUD, status choreography
 * (human semantics), polymorphic assignee, LexoRank ordering (rank module
 * reused), dependencies (DAG-guarded), label catalog, board views, activity
 * timeline, and the project rollup transitions. Access starts from the
 * parent project (reused matrix): its readers read, comment and create
 * tasks, and each task is worked by the project's editors and by the reader
 * whose own task it is (`core/tasks/access.ts`, enforced by
 * {@link assertTaskCreatable} and {@link assertTaskWorkable}).
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

export { TASK_PRIORITIES };
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskAssigneeType = 'user' | 'agent' | 'app';

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'cancelled',
]);

export { TASK_DESCRIPTION_MAX } from '../../core/tasks/helpers.ts';
const TASK_BOARD_CAP = 2000;

export { TaskError } from './errors.ts';

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
  reviewerAgentId: string | null;
  parentTaskId: string | null;
  commentCount: number;
  rank: string;
  externalSystem: string | null;
  externalId: string | null;
  externalUrl: string | null;
  externalSourceId?: string | null;
  externalIssue?: TaskExternalIssue | null;
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
  /** When an external system's `closed` last parked this task — the
   * mirror's claim on the park: its `open` lifts exactly such a park, and
   * any status change through the board's doors clears it. Null for a
   * park a person or an agent made. */
  externalClosedAt: number | null;
  /** The repeat rule as stored — read it through `parseTaskRepeat`, which
   * answers null for a rule that no longer validates. */
  repeat: unknown;
  /** The next copy that continues this task's series (its close's, or the
   * due-date scan's), set once. Null until then, and again once the copy
   * is deleted — which never lets the task continue again: the writer
   * decides on `repeat_continued_at_ms`, which outlives the copy. */
  repeatNextTaskId: string | null;
  /** Whether the task has continued its series (`repeat_continued_at_ms`
   * is set). It stays true once its copy is deleted, and such a task never
   * creates another copy, nor takes a rule again. */
  repeatContinued: boolean;
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
  reviewer_agent_id AS "reviewerAgentId",
  parent_task_id AS "parentTaskId", comment_count AS "commentCount", rank,
  external_system AS "externalSystem", external_id AS "externalId",
  external_url AS "externalUrl", external_source_id AS "externalSourceId",
  external_issue AS "externalIssue", thread_id AS "threadId",
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
  completed_at_ms::float8 AS "completedAt",
  external_closed_at_ms::float8 AS "externalClosedAt",
  repeat_rule AS "repeat", repeat_next_task_id AS "repeatNextTaskId",
  repeat_continued_at_ms IS NOT NULL AS "repeatContinued",
  created_by AS "createdBy",
  created_by_type AS "createdByType", created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt", archived_at_ms::float8 AS "archivedAt"
`;

/** The long columns a board row leaves out: no card or row shows them, and
 * a task's own read still carries them. */
const BOARD_OMITTED_COLUMNS = new Set([
  'description',
  'attachments',
  'outputs',
  'external_issue AS "externalIssue"',
]);

/**
 * The columns a board row carries: {@link TASK_COLUMNS} without the long
 * ones no card or list row shows — the description (up to 20,000
 * characters), the attachment and output lists and the external issue
 * snapshot. A 2,000-task board read all of them, 3.35 MB that every task
 * change made each open board fetch again. The board's search
 * still matches the description in its WHERE clause.
 */
export const BOARD_TASK_COLUMNS = TASK_COLUMNS.split(',')
  .map((column) => column.trim())
  .filter((column) => !BOARD_OMITTED_COLUMNS.has(column))
  .join(', ');

/** A task row as a board reads it ({@link BOARD_TASK_COLUMNS}). */
export type BoardTaskRow = Omit<
  TaskRow,
  'description' | 'attachments' | 'outputs' | 'externalIssue'
>;

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

/** The caller's task access in a project, archive left out: every door
 * refuses an archived project with its own code. Throws the read refusal. */
function readableTaskAccess(
  project: ProjectRow,
  auth: ProjectAuthContext,
): TaskAccess {
  assertTaskProjectSameOrg(project, auth);
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new TaskError('TASK_FORBIDDEN', 'No project access', 403);
  }
  return taskAccessFrom(access);
}

/** Archived = read-only for the whole project, tasks included; the code the
 * project's own writes answer, so the UI can say "restore it first". */
function assertTaskProjectActive(project: ProjectRow): void {
  if (project.archivedAt !== null) {
    throw new TaskError('PROJECT_ARCHIVED', 'Project is archived', 403);
  }
}

/**
 * The create gate: every member who can read the project may add a task to
 * it while it is active (`core/tasks/access.ts`). A subtask is a change to
 * its parent as well, so `createTask` also holds the parent to
 * {@link assertTaskWorkable}.
 */
export function assertTaskCreatable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  readableTaskAccess(project, auth);
  assertTaskProjectActive(project);
}

/** What the work gate reads of a task: whose it is, and the parent it
 * hangs under (the rule looks up the subtask tree for an owner). */
export type WorkableTask = TaskOwnership & { parentTaskId?: string | null };

/**
 * The owners up a task's subtask tree, nearest parent first, as far as
 * {@link TASK_ANCESTRY_DEPTH_MAX} — one bounded recursive read, taken only
 * when the task itself does not settle the question.
 */
async function loadTaskAncestry(
  sql: Sql | TransactionSql,
  organizationId: string,
  parentTaskId: string,
): Promise<TaskOwnership[]> {
  return sql<TaskOwnership[]>`
    WITH RECURSIVE up AS (
      SELECT id, parent_task_id, created_by, created_by_type, assignee_type,
             assignee_id, 1 AS depth
      FROM app.tasks
      WHERE id = ${parentTaskId} AND org_id = ${organizationId}
      UNION ALL
      SELECT t.id, t.parent_task_id, t.created_by, t.created_by_type,
             t.assignee_type, t.assignee_id, up.depth + 1
      FROM app.tasks t JOIN up ON t.id = up.parent_task_id
      WHERE t.org_id = ${organizationId}
        AND up.depth < ${TASK_ANCESTRY_DEPTH_MAX}
    )
    SELECT created_by AS "createdBy", created_by_type AS "createdByType",
           assignee_type AS "assigneeType", assignee_id AS "assigneeId"
    FROM up
    ORDER BY depth
  `;
}

/** `canWorkTask` with the subtask tree read on demand: an editor, or the
 * task itself, answers without a query. */
async function mayWorkWithAccess(
  sql: Sql | TransactionSql,
  access: TaskAccess,
  task: WorkableTask,
  auth: ProjectAuthContext,
): Promise<boolean> {
  if (canWorkTask(access, task, auth.userId)) return true;
  if (access.canEdit || !access.canCreate || task.parentTaskId == null) {
    return false;
  }
  const ancestors = await loadTaskAncestry(
    sql,
    auth.organizationId,
    task.parentTaskId,
  );
  return canWorkTask(access, task, auth.userId, ancestors);
}

/**
 * The gate of every write on one task — its fields, assignee, status and
 * review decision, runs, attachments, dependencies, archive: an editor of
 * the project, or a reader whose own task it is (`canWorkTask`: they
 * created it, it is assigned to them, or it hangs under such a task), on an
 * active project. A reader on someone else's task keeps the read-level
 * verbs: reading it and commenting.
 */
export async function assertTaskWorkable(
  sql: Sql | TransactionSql,
  project: ProjectRow,
  task: WorkableTask,
  auth: ProjectAuthContext,
): Promise<void> {
  const access = readableTaskAccess(project, auth);
  if (!(await mayWorkWithAccess(sql, access, task, auth))) {
    throw new TaskError(
      'RBAC_FORBIDDEN',
      'Only an editor, or the person who created the task or is assigned to it, may change it',
      403,
    );
  }
  assertTaskProjectActive(project);
}

/** {@link assertTaskWorkable} as an answer, for the lanes that downgrade
 * instead of refusing (an @mention that stays a plain mention). */
export async function mayWorkTask(
  sql: Sql | TransactionSql,
  project: ProjectRow,
  task: WorkableTask,
  auth: ProjectAuthContext,
): Promise<boolean> {
  if (project.organizationId !== auth.organizationId) return false;
  return mayWorkWithAccess(sql, boardTaskAccess(project, auth), task, auth);
}

/**
 * The label catalog's gate — creating, renaming, deleting and seeding a
 * project's labels is project administration, an editor's (the Editor role
 * or higher on an active project). Putting an existing label on a task is a
 * change to that task, under {@link assertTaskWorkable}.
 */
export function assertTaskLabelsEditable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  const access = readableTaskAccess(project, auth);
  if (!access.canEdit) {
    throw new TaskError('RBAC_FORBIDDEN', 'Editor role required', 403);
  }
  assertTaskProjectActive(project);
}

/**
 * The board's and the task sheet's access flags: the caller's task access
 * on an ACTIVE project (both false on an archived one). The app decides
 * each task with `canWorkTask` from these and the signed-in person.
 */
export function boardTaskAccess(
  project: ProjectRow,
  auth: ProjectAuthContext,
): TaskAccess {
  const access = taskAccessFrom(
    checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      auth.teamIds,
      auth.role,
    ),
  );
  const active = project.archivedAt === null;
  return {
    canEdit: access.canEdit && active,
    canCreate: access.canCreate && active,
  };
}

/** The archived-task gate: a person's change to an archived task (its fields,
 * status, assignee, starts, comments, dependencies) is refused until someone
 * restores it. Restoring, deleting and stopping a live run stay open. */
export function assertTaskNotArchived(task: Pick<TaskRow, 'archivedAt'>): void {
  if (task.archivedAt !== null) {
    throw new TaskError('TASK_ARCHIVED', 'Task is archived');
  }
}

/** The trimmed title, or a refusal that tells an empty title from an
 * over-long one and names the limit. */
function validateTitle(title: string): string {
  const refusal = taskTitleRefusal(title);
  if (refusal !== null) {
    throw new TaskError('TASK_TITLE_INVALID', refusal);
  }
  return title.trim();
}

function validateDescription(
  description: string | undefined,
): string | undefined {
  if (description == null) {
    return undefined;
  }
  const refusal = taskDescriptionRefusal(description);
  if (refusal !== null) {
    throw new TaskError('TASK_DESCRIPTION_INVALID', refusal);
  }
  return description;
}

/** A start date may not follow the due date. A stored date no `Date` can
 * hold (written before the doors held one to the epoch bound) reads as none
 * here, as it does on the board, so it never blocks setting the other. */
function assertScheduleOrder(
  startDate: number | undefined | null,
  dueDate: number | undefined | null,
): void {
  if (isEpochMs(startDate) && isEpochMs(dueDate) && startDate > dueDate) {
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

/**
 * Label names as the catalog compares them: trimmed and NFC-composed,
 * with their SPELLING kept — `Bug` stays `Bug`. Two names that differ only
 * in case are one label (the catalog is unique per project on
 * `lower(name)`), so the list is deduplicated on the case-folded form and
 * the first spelling wins. Names used to be lower-cased here, which every
 * external system a mirror syncs from treats as a different label.
 */
function normalizeLabelNames(
  labels: string[] | undefined,
): string[] | undefined {
  if (labels == null) {
    return undefined;
  }
  const countRefusal = taskLabelCountRefusal(labels.length);
  if (countRefusal !== null) {
    throw new TaskError('TASK_LABELS_INVALID', countRefusal);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = raw.normalize('NFC').trim();
    const refusal = taskLabelNameRefusal(label);
    if (refusal !== null) {
      throw new TaskError('TASK_LABELS_INVALID', refusal);
    }
    const folded = label.toLowerCase();
    if (!seen.has(folded)) {
      seen.add(folded);
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
    // The catalog matches without regard to case and keeps the spelling
    // the label was created with — a task sent `bug` wears the `Bug` row.
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM app.task_labels
      WHERE project_id = ${args.projectId} AND lower(name) = lower(${name})
      LIMIT 1
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
      ON CONFLICT (project_id, lower(name)) DO UPDATE SET updated_at_ms = ${now}
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
      ON CONFLICT (project_id, lower(name)) DO NOTHING
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
    ORDER BY lower(name) ASC, name ASC
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
  assertTaskLabelsEditable(project, auth);
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
  assertTaskLabelsEditable(project, auth);
  const normalized = normalizeLabelNames([args.name])?.[0];
  if (!normalized) {
    throw new TaskError('TASK_LABELS_INVALID', 'Invalid label name');
  }
  const clash = await tx<{ id: string }[]>`
    SELECT id FROM app.task_labels
    WHERE project_id = ${label.projectId}
      AND lower(name) = lower(${normalized})
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
  assertTaskLabelsEditable(project, auth);
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
  const organizationId = await lockChainBeforeProjectRow(tx, projectId);
  try {
    await tx`
      UPDATE app.projects SET
        open_task_count = greatest(open_task_count + ${openDelta}, 0),
        done_task_count = greatest(done_task_count + ${doneDelta}, 0)
      WHERE id = ${projectId}
    `;
  } catch (error) {
    throw queueOnChain(error, organizationId);
  }
}

/**
 * Take the project's organization audit chain BEFORE its project row.
 *
 * Every task write updates the project row (its number counter, its open
 * and done counts) and appends to the organization's audit chain, and both
 * locks are held until commit. A write that took the row first and the
 * chain second deadlocked with a retry already queued on the chain (which
 * holds the chain from before its transaction began and then needs the
 * row): under a burst of task writes in one project, a cycle a second,
 * each costing the deadlock timeout while every party held a pooled
 * connection. One order — chain, then row — makes the cycle impossible.
 * The chain lock is re-entrant inside the transaction, so the audit append
 * that follows takes it again for free. Returns the organization, or null
 * for a project that does not exist (the UPDATE then touches nothing).
 */
async function lockChainBeforeProjectRow(
  tx: TransactionSql,
  projectId: string,
): Promise<string | null> {
  const rows = await tx<{ organizationId: string }[]>`
    SELECT org_id AS "organizationId" FROM app.projects WHERE id = ${projectId}
  `;
  const organizationId = rows[0]?.organizationId ?? null;
  if (organizationId !== null) await lockAuditChain(tx, organizationId);
  return organizationId;
}

/**
 * A conflict on the project row, met while holding the organization's
 * chain, queues the retry on that chain: the queued attempt then takes the
 * chain before its snapshot, after the writer it lost to has committed,
 * instead of colliding on the row again.
 */
function queueOnChain(error: unknown, organizationId: string | null): unknown {
  return organizationId === null
    ? error
    : markRetryQueueKey(error, auditChainQueueKey(organizationId));
}

/** Claim the next per-project task number in the same transaction. */
export async function nextTaskNumber(
  tx: TransactionSql,
  projectId: string,
): Promise<number> {
  const organizationId = await lockChainBeforeProjectRow(tx, projectId);
  let rows: { taskCounter: number }[];
  try {
    rows = await tx<{ taskCounter: number }[]>`
      UPDATE app.projects SET task_counter = task_counter + 1
      WHERE id = ${projectId}
      RETURNING task_counter AS "taskCounter"
    `;
  } catch (error) {
    throw queueOnChain(error, organizationId);
  }
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
    context?: Record<string, unknown>;
  },
): Promise<void> {
  await tx`
    INSERT INTO app.task_activity (
      org_id, task_id, project_id, actor_type, actor_id, action,
      from_value, to_value, context, created_at_ms
    ) VALUES (
      ${args.task.organizationId}, ${args.task.id}, ${args.task.projectId},
      ${args.actorType}, ${args.actorId}, ${args.action},
      ${args.fromValue ?? null}, ${args.toValue ?? null},
      ${args.context === undefined ? null : tx.json(toJson(args.context))}, ${Date.now()}
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

export function taskAudit(
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
 * behind the picker's (`assignTask`) live-run transfer gate. A same-assignee
 * re-select and clearing an already-unassigned task are not transfers.
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
export async function assertAssigneeValid(
  tx: TransactionSql,
  args: {
    project: ProjectRow;
    auth: Pick<ProjectAuthContext, 'organizationId' | 'userId'>;
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
 *
 * A close is also where a repeating task continues: the seam answers the
 * next copy when this move created one, so every door that closes a card
 * repeats it alike, and the doors a person uses can say where it went.
 */
async function settleTaskStatusChange(
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
    /** Source-owned lifecycle can archive and move atomically, and the source
     * owns recurrence. Other status writers keep their existing choreography. */
    toArchivedAt?: number | null;
    repeat?: boolean;
    context?: Record<string, unknown>;
  },
): Promise<TaskRepeatCopy | null> {
  const { task, toStatus } = args;
  // A move through any board door ends the mirror's claim on a park it
  // made (`external_closed_at_ms`): from here on an external `open` no
  // longer reaches into a card a person or an agent has placed.
  if (typeof task.externalClosedAt === 'number' && task.status !== toStatus) {
    await tx`
      UPDATE app.tasks SET external_closed_at_ms = NULL WHERE id = ${task.id}
    `;
  }
  await applyTaskCountTransition(
    tx,
    task.projectId,
    taskCountBucket(task),
    taskCountBucket({
      status: toStatus,
      archivedAt:
        args.toArchivedAt === undefined ? task.archivedAt : args.toArchivedAt,
    }),
  );
  await recordActivity(tx, {
    task,
    actorType: args.actorType,
    actorId: args.actorId,
    action: 'status.changed',
    fromValue: task.status,
    toValue: toStatus,
    ...(args.context !== undefined ? { context: args.context } : {}),
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
  if (args.repeat === false) return null;
  return await createNextRepeatCopy(tx, {
    task,
    toStatus,
    actorType: args.actorType,
    actorId: args.actorId,
    ...(args.audit !== undefined ? { audit: args.audit } : {}),
  });
}

/**
 * The post-write step every ASSIGNEE door shares (the assign verb and the
 * bulk bar): the activity line, the audit row, and the assignment fan-out —
 * the new human assignee is subscribed and belled, the one who lost the
 * work is told. `task` is the row BEFORE the write.
 */
async function settleTaskAssigneeChange(
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

/**
 * One file a person hung on a task: the client-named blob ref plus the
 * display trio the dialog shows. The `attachments` column holds a list of
 * these; the agent's brief mirrors them into its sandbox as inputs.
 */
export interface TaskAttachmentEntry {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/** The stored `attachments` column read back as entries; malformed elements
 * are skipped (the column is written only by this shape). */
export function parseTaskAttachments(column: unknown): TaskAttachmentEntry[] {
  if (!Array.isArray(column)) return [];
  const entries: TaskAttachmentEntry[] = [];
  for (const element of column) {
    if (
      element === null ||
      typeof element !== 'object' ||
      !('fileId' in element) ||
      typeof element.fileId !== 'string' ||
      element.fileId === ''
    ) {
      continue;
    }
    entries.push({
      fileId: element.fileId,
      fileName:
        'fileName' in element && typeof element.fileName === 'string'
          ? element.fileName
          : '',
      fileType:
        'fileType' in element && typeof element.fileType === 'string'
          ? element.fileType
          : '',
      fileSize:
        'fileSize' in element && typeof element.fileSize === 'number'
          ? element.fileSize
          : 0,
    });
  }
  return entries;
}

/** A submitted attachment list, bounded and de-duplicated by ref (first
 * wins), display names trimmed to the column's 255. */
function normalizeAttachments(
  list: readonly TaskAttachmentEntry[],
): TaskAttachmentEntry[] {
  if (list.length > TASK_ATTACHMENTS_MAX) {
    throw new TaskError(
      'TASK_ATTACHMENTS_INVALID',
      `A task carries at most ${TASK_ATTACHMENTS_MAX} attachments`,
    );
  }
  const seen = new Set<string>();
  const entries: TaskAttachmentEntry[] = [];
  for (const entry of list) {
    const fileName = entry.fileName.trim().slice(0, 255);
    if (entry.fileId === '' || fileName === '') {
      throw new TaskError(
        'TASK_ATTACHMENTS_INVALID',
        'Every attachment needs a file ref and a name',
      );
    }
    if (seen.has(entry.fileId)) continue;
    seen.add(entry.fileId);
    entries.push({
      fileId: entry.fileId,
      fileName,
      fileType: entry.fileType.slice(0, 255),
      fileSize: entry.fileSize,
    });
  }
  return entries;
}

/**
 * The start-date bell's stamp for a start being written now. A start that
 * has already arrived — today, picked as the new task's default, or a day
 * in the past — was set by someone looking at the task, so it is written as
 * already announced and the hourly sweep sends no "starts today" bell for
 * it; a start still ahead stays unstamped and rings when its day comes.
 */
function startArrivedStamp(
  startDate: number | null,
  now: number,
): number | null {
  return startDate !== null && startDate <= now ? now : null;
}

/**
 * Attachments are client-named blob refs. Each ref NEW to the task must be
 * the caller's own upload (their upload intent inside its TTL, or the file
 * row they registered) — a document's ref, which every reader of that
 * document holds, is not theirs to hang on a task, and a guessed ref must
 * not let the agent's brief stage another user's bytes. Refs already on the
 * task stay whoever attached them: removing one file re-sends the rest.
 */
async function assertOwnedTaskAttachments(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  fileIds: readonly string[],
): Promise<void> {
  if (fileIds.length === 0) return;
  const foreign = await firstForeignUpload(
    tx,
    { organizationId: auth.organizationId, userId: auth.userId },
    fileIds,
  );
  if (foreign !== null) {
    throw new TaskError(
      'TASK_ATTACHMENT_NOT_OWNED',
      'An attachment is not one of your uploads. Remove it and attach the file again.',
      403,
    );
  }
}

export interface CreateTaskArgs {
  projectId: string;
  title: string;
  description?: string;
  attachments?: TaskAttachmentEntry[];
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assigneeType?: TaskAssigneeType;
  assigneeId?: string;
  parentTaskId?: string;
  startDate?: number;
  dueDate?: number;
  /** The rule the task repeats on: closing it creates the next copy. */
  repeat?: TaskRepeat;
  /** The conversation the task was handed over from — its root thread, one
   * the creator can read (`source-thread.ts`). */
  sourceThreadId?: string;
}

export async function createTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: CreateTaskArgs,
  /** Internal managed provisioning only; no generic task input exposes IDs. */
  identity?: { taskId: string },
): Promise<string> {
  const explicitId =
    identity === undefined ? undefined : z.uuid().parse(identity.taskId);
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertTaskCreatable(project, auth);

  const title = validateTitle(args.title);
  const sentDescription = validateDescription(args.description);
  const labelIds = await resolveProjectLabels(tx, {
    organizationId: auth.organizationId,
    projectId: args.projectId,
    names: args.labels,
    createdBy: auth.userId,
  });
  assertScheduleOrder(args.startDate, args.dueDate);
  const repeat =
    args.repeat !== undefined ? validateTaskRepeat(args.repeat) : null;
  const status = args.status ?? 'backlog';
  const assignee = normalizeAssignee(args);
  if (repeat !== null) {
    assertTaskCanRepeat({
      parentTaskId: args.parentTaskId ?? null,
      status,
      assigneeType: assignee?.assigneeType ?? null,
      assigneeId: assignee?.assigneeId ?? null,
      createdByType: 'user',
    });
  }
  await assertAssigneeValid(tx, { project, auth, assignee });
  if (assignee?.assigneeType === 'app') {
    await assertAutomationForTask(tx, {
      project,
      auth,
      task: null,
      automation: assignee.assigneeId,
    });
  }
  const attachments =
    args.attachments !== undefined
      ? normalizeAttachments(args.attachments)
      : [];
  await assertOwnedTaskAttachments(
    tx,
    auth,
    attachments.map((entry) => entry.fileId),
  );
  if (args.sourceThreadId !== undefined) {
    await assertTaskSourceThreadReadable(tx, {
      organizationId: auth.organizationId,
      userId: auth.userId,
      threadId: args.sourceThreadId,
    });
  }

  if (args.parentTaskId) {
    const parent = await loadTaskOrThrow(
      tx,
      args.parentTaskId,
      auth.organizationId,
    );
    if (parent.projectId !== args.projectId) {
      throw new TaskError('TASK_PARENT_PROJECT_MISMATCH', 'Parent mismatch');
    }
    // A subtask changes its parent too — the parent cannot close while it
    // is open — so it is added by whoever may work the parent.
    await assertTaskWorkable(tx, project, parent, auth);
    if (parent.archivedAt !== null) {
      throw new TaskError('TASK_PARENT_ARCHIVED', 'Parent archived');
    }
  }

  // The description is stored with its mentions as whom they name, before
  // the row is written.
  const prepared =
    sentDescription === undefined ||
    !editIntroducesMentions(sentDescription, '')
      ? undefined
      : await prepareSurfaceText(tx, {
          organizationId: auth.organizationId,
          projectId: args.projectId,
          body: sentDescription,
          cap: TASK_DESCRIPTION_MAX,
          mode: 'full',
        });
  const description = prepared?.text ?? sentDescription;

  const now = Date.now();
  const rank = await computeEndRank(tx, args.projectId, status);
  const number = await nextTaskNumber(tx, args.projectId);

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.tasks (
      org_id, project_id, title, description, attachments, status, priority,
      label_ids, assignee_type, assignee_id, parent_task_id, start_date_ms,
      start_notified_at_ms, due_date_ms, repeat_rule, rank, number, created_by,
      created_by_type, created_at_ms, updated_at_ms, status_changed_at_ms,
      completed_at_ms, source_thread_id, id
    ) VALUES (
      ${auth.organizationId}, ${args.projectId}, ${title},
      ${description ?? null},
      ${attachments.length > 0 ? tx.json(toJson(attachments)) : null},
      ${status}, ${args.priority ?? null},
      ${labelIds ?? []}, ${assignee?.assigneeType ?? null},
      ${assignee?.assigneeId ?? null}, ${args.parentTaskId ?? null},
      ${args.startDate ?? null},
      ${startArrivedStamp(args.startDate ?? null, now)},
      ${args.dueDate ?? null},
      ${repeat !== null ? tx.json(toJson(repeat)) : null}, ${rank}, ${number},
      ${auth.userId}, 'user', ${now}, ${now}, ${now},
      ${TERMINAL_STATUSES.has(status) ? now : null},
      ${args.sourceThreadId ?? null}, ${explicitId ?? tx`DEFAULT`}
    )
    RETURNING id
  `;
  const taskId = inserted[0]?.id;
  if (!taskId) {
    throw new Error('TASK_CREATE_FAILED: the insert answered no row');
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
  // The status choreography applies to a card BORN in a column too — the
  // create dialog offers the full picker: an agent-owned task created
  // straight at In progress gets its run (the board never shows an
  // in-progress agent task with no run behind it), and one created at In
  // review opens the review gate, the same two rules a move enforces.
  if (status === 'in_progress') {
    await kickAssignedAgentRun(tx, auth, {
      id: taskId,
      projectId: args.projectId,
      assigneeType: assignee?.assigneeType ?? null,
      assigneeId: assignee?.assigneeId ?? null,
    });
  }
  // After the In progress kick, so an agent the card was born working for
  // keeps its run: one engine per task, and the dispatcher yields to it.
  if (prepared !== undefined && description !== undefined) {
    await fanOutDescriptionMentions(tx, auth, {
      taskId,
      project,
      description,
      added: prepared.added,
    });
  }
  // Before the review gate: a named agent put to work moves the card to In
  // progress, whatever column it was born in (a comment naming it on a
  // closed card does the same). A review opened first would ring the
  // reviewer and be withdrawn in this same write. The gate opens for a card
  // still at In review — no agent named, or its start refused.
  if (status === 'in_review') {
    const born = await loadTaskOrThrow(tx, taskId, auth.organizationId);
    if (born.status === 'in_review') {
      await requestTaskReview(tx, {
        task: born,
        trigger: { kind: 'human', actorId: auth.userId },
      });
    }
  }
  return taskId;
}

export interface UpdateTaskArgs {
  taskId: string;
  title?: string;
  description?: string | null;
  /** Full replace, like labels: the dialog sends the whole list on every
   * add and remove. */
  attachments?: TaskAttachmentEntry[];
  priority?: TaskPriority | null;
  labels?: string[];
  startDate?: number | null;
  dueDate?: number | null;
  reviewerUserId?: string | null;
  /** The new repeat rule, or null for "does not repeat" (which ends the
   * series: the task's close creates no copy). A rule is refused on a task
   * that already continued its series. */
  repeat?: TaskRepeat | null;
}

/**
 * The single seat of the field-key → activity-action vocabulary. Each entry
 * maps a key in {@link updateTask}'s `newState` map to the action name
 * stored on the row, mirroring the existing `status.changed` /
 * `assignee.changed` naming. Keys not listed here have no activity
 * counterpart (the audit row still records them).
 */
const EDIT_ACTIVITY_ACTION: Record<string, string> = {
  title: 'title.changed',
  description: 'description.changed',
  priority: 'priority.changed',
  labelIds: 'labels.changed',
  attachments: 'attachments.changed',
  startDate: 'startDate.changed',
  dueDate: 'dueDate.changed',
  reviewerUserId: 'reviewer.changed',
  repeat: 'repeat.changed',
};

/**
 * Resolve a set of label ids to their catalog names in the same order.
 * Used by {@link updateTask} to turn a `labels.changed` row's id arrays
 * into something a reader can parse at a glance ("Bug, Feature" instead
 * of "lbl_3f7c, lbl_1a2b"). An id the catalog no longer has falls back
 * to its raw id — the stale row will read like the rest of the timeline
 * a getter pulls in a flaky data shape.
 */
async function resolveLabelNames(
  tx: TransactionSql,
  projectId: string,
  ids: readonly string[],
): Promise<string> {
  if (ids.length === 0) return '';
  const rows = await tx<{ id: string; name: string }[]>`
    SELECT id, name FROM app.task_labels
    WHERE project_id = ${projectId} AND id = ANY(${[...ids]})
  `;
  const nameById = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => nameById.get(id) ?? id).join(', ');
}

function stringifyEditScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  // The `previousState` / `newState` maps hold the typed columns (strings,
  // numbers, string arrays). Anything else would be a programming error,
  // and we want the linter's `no-base-to-string` rule to stay satisfied.
  if (Array.isArray(value))
    return value.map((entry) => String(entry)).join(', ');
  return '';
}

/**
 * Resolve one activity value side (previous or new) of a `previousState` /
 * `newState` field already guarded by an updateTask diff. The mapping
 * mirrors {@link EDIT_ACTIVITY_ACTION}: the same keys appear here, with
 * the exception that `null` and `undefined` both stringify to '' (the
 * timeline's "cleared" sentinel). The `labels.changed` action is
 * computed separately — its values are arrays of CATALOG ids that need a
 * name lookup before the timeline can render them; see the labels branch
 * in `updateTask` itself.
 */
function stringifyEditValue(action: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  return stringifyEditScalar(value);
}

export async function readTaskInstructionsConfiguration(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  taskId: string,
) {
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
  if (task.projectId !== projectId)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  const config = { projectId, taskId, description: task.description ?? '' };
  return { config, hash: managedConfigurationHash(config) };
}

/** The managed lane changes only description, through the ordinary task edit
 * effects. Compare and edit share the route's serializable transaction. */
export async function updateTaskInstructionsConfiguration(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  config: { projectId: string; taskId: string; description: string },
  expectedHash: string,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, config.taskId, auth.organizationId);
  if (task.projectId !== config.projectId)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  const project = await loadProjectOrThrow(tx, config.projectId);
  await assertTaskWorkable(tx, project, task, auth);
  assertTaskNotArchived(task);
  const description = validateDescription(config.description) ?? '';
  assertExpectedHash(
    managedConfigurationHash({
      projectId: config.projectId,
      taskId: config.taskId,
      description: task.description ?? '',
    }),
    expectedHash,
  );
  if ((task.description ?? '') === description) return;
  // Stored exactly as sent, so the hash the caller reads back is the one it
  // wrote; a mention token it adds must still name someone who can be
  // mentioned on the task.
  const check = await prepareSurfaceText(tx, {
    organizationId: auth.organizationId,
    projectId: config.projectId,
    body: description,
    cap: TASK_DESCRIPTION_MAX,
    mode: 'verbatim',
    previousBody: task.description ?? '',
  });
  if (check.invalidTokens.length > 0) {
    throw new TaskError(
      'TASK_MENTION_INVALID',
      'The description mentions someone who cannot be mentioned on this task.',
      400,
      { mentions: check.invalidTokens },
    );
  }
  await updateTaskFields(
    tx,
    auth,
    { taskId: config.taskId, description },
    undefined,
    { notifyDescriptionMentions: false, storeVerbatim: true },
  );
}

export async function updateTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: UpdateTaskArgs,
): Promise<void> {
  await updateTaskFields(tx, auth, args);
}

/** Only the trusted metadata door may supply an agent actor, and that door
 * passes priority alone. Human edits keep their existing authority and trail. */
async function updateTaskFields(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: UpdateTaskArgs,
  agentId?: string,
  options: {
    notifyDescriptionMentions?: boolean;
    /** Store the description exactly as sent (the managed lane, which has
     * checked its mentions itself). */
    storeVerbatim?: boolean;
  } = {},
): Promise<void> {
  const task = await loadTaskOrThrow(tx, args.taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertTaskWorkable(tx, project, task, auth);
  assertTaskNotArchived(task);

  // Working one's own task does not confer project review administration.
  // An unchanged field sent with an ordinary edit remains a no-op.
  if (
    args.reviewerUserId !== undefined &&
    args.reviewerUserId !== task.reviewerUserId
  ) {
    assertTaskLabelsEditable(project, auth);
  }

  const previousState: Record<string, unknown> = {};
  const newState: Record<string, unknown> = {};

  let title = task.title;
  if (args.title !== undefined) {
    title = validateTitle(args.title);
    if (title !== task.title) {
      previousState.title = task.title;
      newState.title = title;
    }
  }
  let description = task.description;
  let addedMentions: ResolvedMention[] = [];
  if (args.description !== undefined) {
    description =
      args.description === null
        ? null
        : (validateDescription(args.description) ?? null);
    // An edit is a new write: what it adds is stored as whom it names, while
    // the mentions already there stay as written. Most edits add none, and
    // then no directory is built.
    if (
      description !== null &&
      description !== task.description &&
      options.storeVerbatim !== true &&
      editIntroducesMentions(description, task.description ?? '')
    ) {
      const prepared = await prepareSurfaceText(tx, {
        organizationId: auth.organizationId,
        projectId: task.projectId,
        body: description,
        cap: TASK_DESCRIPTION_MAX,
        mode: descriptionMentionMode(task.externalSystem),
        previousBody: task.description ?? '',
      });
      description = prepared.text;
      addedMentions = prepared.added;
    }
    if (description !== task.description) {
      previousState.description = task.description;
      newState.description = description;
    }
  }
  let priority = task.priority;
  if (args.priority !== undefined) {
    priority = args.priority;
    // Diff guard: `priority: null → null` or `priority: 'p0' → 'p0'` is a
    // no-op (it can happen when the picker re-sends the same value on blur);
    // skip the audit / activity row.
    if (priority !== task.priority) {
      previousState.priority = task.priority;
      newState.priority = priority;
    }
  }
  // Attachments: the NEW refs must be the caller's own uploads; the refs
  // the list drops go to the blob release seam once the row no longer
  // names them (the same seam a hard delete uses).
  let nextAttachments: TaskAttachmentEntry[] | undefined;
  let droppedRefs: string[] = [];
  if (args.attachments !== undefined) {
    const current = parseTaskAttachments(task.attachments);
    const next = normalizeAttachments(args.attachments);
    const currentRefs = new Set(current.map((entry) => entry.fileId));
    const nextRefs = new Set(next.map((entry) => entry.fileId));
    await assertOwnedTaskAttachments(
      tx,
      auth,
      next
        .filter((entry) => !currentRefs.has(entry.fileId))
        .map((entry) => entry.fileId),
    );
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      nextAttachments = next;
      droppedRefs = current
        .filter((entry) => !nextRefs.has(entry.fileId))
        .map((entry) => entry.fileId);
      previousState.attachments = current.map((entry) => entry.fileName);
      newState.attachments = next.map((entry) => entry.fileName);
    }
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
    // Skip the no-op: a re-save that sends the same set of labels leaves
    // both the audit row's diff and the activity timeline's `labels.changed`
    // empty — only an actual add / remove / reorder earns a row.
    const sortedBefore = [...task.labelIds].sort();
    const sortedAfter = [...labelIds].sort();
    if (
      sortedBefore.length !== sortedAfter.length ||
      sortedBefore.some((id, index) => id !== sortedAfter[index])
    ) {
      previousState.labelIds = task.labelIds;
      newState.labelIds = labelIds;
    }
  }
  const startDate =
    args.startDate === undefined ? task.startDate : args.startDate;
  const dueDate = args.dueDate === undefined ? task.dueDate : args.dueDate;
  assertScheduleOrder(startDate, dueDate);
  if (args.startDate !== undefined && startDate !== task.startDate) {
    previousState.startDate = task.startDate;
    newState.startDate = startDate;
  }
  if (args.dueDate !== undefined && dueDate !== task.dueDate) {
    previousState.dueDate = task.dueDate;
    newState.dueDate = dueDate;
  }
  let reviewerUserId = task.reviewerUserId;
  if (args.reviewerUserId !== undefined) {
    reviewerUserId = args.reviewerUserId;
    // Same diff guard as labels: clearing an already-cleared reviewer (or
    // re-selecting the same one) is a no-op and earns no audit or activity
    // row.
    if (reviewerUserId !== task.reviewerUserId) {
      previousState.reviewerUserId = task.reviewerUserId;
      newState.reviewerUserId = reviewerUserId;
    }
  }
  // The rule compares by what it says — its days and its step. The zone
  // only records where it was set, so the same rule re-sent from another
  // zone is a no-op and keeps the zone the series has been dated in.
  let repeat: TaskRepeat | null = null;
  let repeatChanged = false;
  if (args.repeat !== undefined) {
    const current = parseTaskRepeat(task.repeat);
    repeat = args.repeat === null ? null : validateTaskRepeat(args.repeat);
    // "Does not repeat" is always allowed; a rule only on a task that can
    // carry one. A task that has continued its series never continues it
    // again — not even once that copy is deleted — so a rule on it would
    // promise a next task nothing ever creates.
    if (repeat !== null) {
      assertTaskCanRepeat(task);
      if (task.repeatContinued) {
        throw new TaskError(
          'TASK_REPEAT_INVALID',
          'This task already created its next task',
        );
      }
    }
    if (!sameTaskRepeat(current, repeat)) {
      repeatChanged = true;
      previousState.repeat = current;
      newState.repeat = repeat;
    }
  }
  if (
    args.reviewerUserId !== undefined &&
    reviewerUserId !== task.reviewerUserId
  ) {
    const pending = await getPendingReviewForTask(
      tx,
      auth.organizationId,
      task.id,
    );
    if (
      task.reviewerAgentId != null ||
      pending?.reviewer?.kind === 'agent' ||
      (reviewerUserId === null && project.defaultTaskReviewerAgentId != null)
    ) {
      throw new TaskError(
        'TASK_REVIEWER_HANDOFF_REQUIRED',
        'Use an explicit reviewer handoff for agent-owned review',
        409,
      );
    }
  }
  // A NEW designee (not a clear, not a re-select) is about to be subscribed
  // and belled, so they must be someone the gate would actually hand the
  // review to — the one rule `reviewerEligibility` holds the gate to. A
  // designee without project edit access used to be stored and then routed
  // past at mint, the review silently landing on a creator. The picker
  // offers eligible members only, so a miss is a stale or hand-built
  // request; re-selecting a designee who has since lost access is no
  // designation and passes, and the gate routes past them as before.
  const designatedReviewer =
    args.reviewerUserId !== undefined &&
    reviewerUserId !== null &&
    reviewerUserId !== task.reviewerUserId
      ? reviewerUserId
      : null;
  if (designatedReviewer !== null) {
    const eligibility = await reviewerEligibility(tx, {
      organizationId: auth.organizationId,
      projectTeamIds: project.teamIds,
      userId: designatedReviewer,
    });
    if (eligibility === 'not_member') {
      throw new TaskError(
        'TASK_REVIEWER_INVALID',
        'The reviewer must be an active member of this organization',
      );
    }
    if (eligibility === 'cannot_edit') {
      throw new TaskError(
        'TASK_REVIEWER_NO_EDIT_ACCESS',
        'The reviewer must be able to edit this project',
      );
    }
  }

  if (Object.keys(newState).length === 0) {
    return;
  }
  // A rescheduled task re-enters the date ladder: a changed due date clears
  // the SLA rung (so "due soon", the nudge and the escalations fire again
  // for the new date) and a changed start date clears the one-shot start
  // stamp — or sets it, when the new start has already arrived. Without this
  // the ladder stayed off for good once it had fired — the common "overdue →
  // pushed out" flow silenced every later alert.
  const dueChanged = args.dueDate !== undefined && dueDate !== task.dueDate;
  const startChanged =
    args.startDate !== undefined && startDate !== task.startDate;
  await tx`
    UPDATE app.tasks SET
      title = ${title}, description = ${description},
      priority = ${priority}, label_ids = ${labelIds},
      start_date_ms = ${startDate}, due_date_ms = ${dueDate},
      sla_level = CASE WHEN ${dueChanged}::boolean THEN NULL ELSE sla_level END,
      sla_level_at_ms = CASE WHEN ${dueChanged}::boolean THEN NULL
                             ELSE sla_level_at_ms END,
      start_notified_at_ms = CASE WHEN ${startChanged}::boolean
                                  THEN ${startArrivedStamp(startDate, Date.now())}::bigint
                                  ELSE start_notified_at_ms END,
      attachments = CASE WHEN ${nextAttachments !== undefined}::boolean
                         THEN ${nextAttachments !== undefined && nextAttachments.length > 0 ? tx.json(toJson(nextAttachments)) : null}::jsonb
                         ELSE attachments END,
      repeat_rule = CASE WHEN ${repeatChanged}::boolean
                         THEN ${repeat !== null ? tx.json(toJson(repeat)) : null}::jsonb
                         ELSE repeat_rule END,
      reviewer_user_id = ${reviewerUserId}, updated_at_ms = ${Date.now()}
    WHERE id = ${args.taskId}
  `;
  if (droppedRefs.length > 0) {
    await releaseUnlistedTaskBlobRefs(tx, auth.organizationId, droppedRefs);
  }
  // One activity row PER CHANGED FIELD. The legacy single `action:
  // 'updated'` row stays in the schema for back-compat with anything
  // already in `task_activity`; new edits bypass it. The audit row keeps
  // a single entry per `updateTask` call with the full diff — the
  // product-facing timeline just gets one line per hand a reader can scan
  // on the modal, the way `status.changed` and `assignee.changed` already
  // do.
  for (const [field, action] of Object.entries(EDIT_ACTIVITY_ACTION)) {
    const newValue = newState[field];
    if (newValue === undefined) continue;
    const previousValue = previousState[field];
    let toValue: string | undefined = stringifyEditValue(action, newValue);
    let fromValue: string | undefined = stringifyEditValue(
      action,
      previousValue,
    );
    // A rule rides whole, as the JSON it is stored as, so the timeline can
    // phrase both sides in the reader's language; "does not repeat" is no
    // value at all.
    if (action === 'repeat.changed') {
      fromValue =
        previousValue === null ? undefined : JSON.stringify(previousValue);
      toValue = newValue === null ? undefined : JSON.stringify(newValue);
    }
    if (action === 'labels.changed') {
      const fromIds: readonly string[] = Array.isArray(previousValue)
        ? previousValue
        : [];
      const toIds: readonly string[] = Array.isArray(newValue) ? newValue : [];
      const [fromNames, toNames] = await Promise.all([
        resolveLabelNames(tx, task.projectId, fromIds),
        resolveLabelNames(tx, task.projectId, toIds),
      ]);
      fromValue = fromNames;
      toValue = toNames;
    }
    if (fromValue === toValue) continue;
    await recordActivity(tx, {
      task,
      actorType: agentId === undefined ? 'user' : 'agent',
      actorId: agentId ?? auth.userId,
      action,
      fromValue,
      toValue,
    });
  }
  await createAuditLog(tx, {
    ...taskAudit(auth, { id: task.id, title }, TASK_AUDIT_ACTIONS.updated, {
      previousState,
      newState,
    }),
    ...(agentId !== undefined
      ? {
          actorType: 'api' as const,
          actorId: agentId,
          metadata: { viaAgent: true, projectId: task.projectId },
        }
      : {}),
  });
  // A review already open follows the designation in this transaction: the
  // board chip, "Needs my review" and the request bell all read its
  // `requestedFor`, which the mint stamped once — without this a change
  // mid-review left the request with the reviewer it was taken from.
  const openReviewer =
    reviewerUserId !== task.reviewerUserId
      ? await retargetPendingTaskReview(tx, {
          task: { ...task, title, reviewerUserId },
          actorUserId: auth.userId,
        })
      : undefined;
  await notifyReviewerDesignation(tx, {
    task: { ...task, title },
    reviewerUserId,
    openReviewer,
    actorUserId: auth.userId,
  });
  // An edit fans out only the mentions it ADDS: prose reworded around an
  // existing `@handle` must not ring the bell or start the agent again.
  if (
    options.notifyDescriptionMentions !== false &&
    newState.description !== undefined &&
    description !== null
  ) {
    await fanOutDescriptionMentions(tx, auth, {
      taskId: task.id,
      project,
      description,
      added: addedMentions,
    });
  }
}

async function notifyReviewerDesignation(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    reviewerUserId: string | null;
    openReviewer: string | undefined;
    actorUserId: string;
  },
): Promise<void> {
  const { task, reviewerUserId, openReviewer, actorUserId } = args;
  const designatedReviewer =
    reviewerUserId !== null && reviewerUserId !== task.reviewerUserId
      ? reviewerUserId
      : null;
  // The previous designee is off the hook: an unread "You're the reviewer"
  // heads-up would keep telling them otherwise. Their request bell, when the
  // review was open, went with the retarget above.
  if (task.reviewerUserId !== null && reviewerUserId !== task.reviewerUserId) {
    await dismissReviewerAssignedNotifications(tx, {
      organizationId: task.organizationId,
      taskId: task.id,
      userId: task.reviewerUserId,
    });
  }
  if (designatedReviewer !== null) {
    // The designee owns the gate from now on: they follow the task (its
    // progress, not just the request moment) and get the heads-up bell —
    // "you're on the hook for this one". The actionable request + email
    // follow when the card reaches In review. Before this, the column was
    // written and nobody was told.
    await autoSubscribe(tx, {
      organizationId: task.organizationId,
      taskId: task.id,
      subscriberType: 'user',
      subscriberId: designatedReviewer,
      reason: 'reviewer',
    });
    // Once the open request is theirs it IS their bell: the heads-up shares
    // its collapse identity and would rewrite the actionable row in place.
    if (openReviewer !== designatedReviewer) {
      await notifyTaskReviewerAssigned(tx, {
        organizationId: task.organizationId,
        task: { id: task.id, projectId: task.projectId, title: task.title },
        reviewerUserId: designatedReviewer,
        actorUserId,
      });
    }
  }
}

/** Read both the future routing choice and the captured current gate. */
export async function getTaskReviewer(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
) {
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  return {
    reviewer: taskReviewerFromIds(task),
    projectReviewer: projectTaskReviewerFromId(
      project.defaultTaskReviewerAgentId,
    ),
    pendingReview: await getPendingReviewForTask(
      sql,
      auth.organizationId,
      task.id,
    ),
  };
}

/** The editor-only handoff changes routing, never the implementation owner,
 * status, outputs, execution or tool grants. Every expected field is CAS. */
export async function setTaskReviewer(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
  args: SetTaskReviewerInput,
) {
  const initial = await loadTaskOrThrow(tx, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, initial.projectId);
  assertTaskLabelsEditable(project, auth);
  assertTaskNotArchived(initial);
  await lockTaskRunStart(tx, auth.organizationId, taskId);
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
  assertTaskNotArchived(task);
  const expectedUserId =
    args.expected.reviewer.kind === 'user'
      ? args.expected.reviewer.userId
      : null;
  const expectedAgentId =
    args.expected.reviewer.kind === 'agent'
      ? args.expected.reviewer.agentId
      : null;
  if (
    task.reviewerUserId !== expectedUserId ||
    (task.reviewerAgentId ?? null) !== expectedAgentId
  ) {
    throw new TaskError(
      'TASK_REVIEWER_STALE',
      'Task reviewer changed; read it again',
      409,
    );
  }
  const reviewerUserId =
    args.reviewer.kind === 'user' ? args.reviewer.userId : null;
  const reviewerAgentId =
    args.reviewer.kind === 'agent' ? args.reviewer.agentId : null;
  if (reviewerUserId !== null && reviewerUserId !== task.reviewerUserId) {
    const eligibility = await reviewerEligibility(tx, {
      organizationId: auth.organizationId,
      projectTeamIds: project.teamIds,
      userId: reviewerUserId,
    });
    if (eligibility !== 'eligible') {
      throw new TaskError(
        'TASK_REVIEWER_INVALID',
        'Choose an active member with project edit access',
      );
    }
  }
  const effectiveAgentId =
    reviewerAgentId ??
    (reviewerUserId === null ? project.defaultTaskReviewerAgentId : null);
  if (effectiveAgentId != null) {
    // The picker greys an agent without the review grant and says why; the
    // door keeps that reason apart from "not an agent of this project", so
    // a stale list or a hand-built request is told what to fix.
    const agentEligibility = await agentReviewerEligibility(tx, {
      organizationId: auth.organizationId,
      projectId: task.projectId,
      agentId: effectiveAgentId,
    });
    if (agentEligibility === 'permission_missing')
      throw new TaskError(
        'TASK_REVIEWER_PERMISSION_MISSING',
        'Grant this agent the task review permission before choosing it',
      );
    if (agentEligibility !== 'eligible')
      throw new TaskError(
        'TASK_REVIEWER_INVALID',
        'Choose an agent in this project',
      );
    if (task.assigneeType === 'agent' && task.assigneeId === effectiveAgentId) {
      throw new TaskError(
        'TASK_REVIEWER_NOT_INDEPENDENT',
        'Choose an agent other than the implementation agent',
        409,
      );
    }
  }
  const resolvesToAgent = effectiveAgentId != null;
  if (
    resolvesToAgent &&
    args.expected.pendingReview !== null &&
    (await taskHasLiveRun(tx, task))
  ) {
    throw new TaskError(
      'TASK_REVIEWER_BUSY',
      'The task still has active work or a protected question',
      409,
    );
  }
  const next = { ...task, reviewerUserId, reviewerAgentId };
  await replacePendingTaskReviewer(tx, {
    task: next,
    expected: args.expected.pendingReview,
    actorUserId: auth.userId,
  });
  const pendingReview = await getPendingReviewForTask(
    tx,
    auth.organizationId,
    taskId,
  );
  const changed =
    task.reviewerUserId !== reviewerUserId ||
    (task.reviewerAgentId ?? null) !== reviewerAgentId ||
    (pendingReview?.approvalId ?? null) !==
      (args.expected.pendingReview?.approvalId ?? null);
  if (!changed) return { reviewer: args.reviewer, pendingReview };
  await tx`
    UPDATE app.tasks SET reviewer_user_id = ${reviewerUserId},
      reviewer_agent_id = ${reviewerAgentId}, updated_at_ms = ${Date.now()}
    WHERE id = ${taskId} AND org_id = ${auth.organizationId}
  `;
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'reviewer.changed',
    fromValue: JSON.stringify(taskReviewerFromIds(task)),
    toValue: JSON.stringify(args.reviewer),
  });
  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.updated, {
      previousState: {
        reviewer: taskReviewerFromIds(task),
        approvalId: args.expected.pendingReview?.approvalId ?? null,
      },
      newState: {
        reviewer: args.reviewer,
        approvalId: pendingReview?.approvalId ?? null,
      },
    }),
  );
  await notifyReviewerDesignation(tx, {
    task,
    reviewerUserId,
    actorUserId: auth.userId,
    openReviewer:
      pendingReview?.reviewer?.kind === 'user'
        ? pendingReview.reviewer.userId
        : undefined,
  });
  return { reviewer: args.reviewer, pendingReview };
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

/** Answers the next copy when the move closed a repeating task. */
export async function updateTaskStatus(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
  status: TaskStatus,
): Promise<TaskRepeatCopy | null> {
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertTaskWorkable(tx, project, task, auth);
  assertTaskNotArchived(task);
  if (task.status === status) {
    return null;
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
  await cancelLiveAgentRunOnLeave(tx, task, status);

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
  const nextTask = await settleTaskStatusChange(tx, {
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
  if (status === 'in_progress') {
    await kickAssignedAgentRun(tx, auth, { ...task, id: taskId });
  }
  // Reaching `in_review` IS the request for review, whoever submitted —
  // the gate belongs to the STATE, not to the agent lane.
  if (status === 'in_review') {
    await requestTaskReview(tx, {
      task: { ...task, status: 'in_review' },
      trigger: { kind: 'human', actorId: auth.userId },
    });
  }
  return nextTask;
}

/** An accepted custom-source business result is evidence, never a native Tale
 * approval. The external-status door owns authorization, binding and CAS; this
 * seam keeps board counts, rank, run cancellation, history and bells coherent.
 * It never starts an agent, requests a second review or continues a local series. */
export async function applyExternalTaskStatusProjection(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    actorId: string;
    status: TaskStatus;
    archived: boolean;
    context: Record<string, unknown>;
  },
): Promise<void> {
  const { task, status } = args;
  const statusChanges = task.status !== status;
  const archiveChanges = (task.archivedAt !== null) !== args.archived;
  if (
    statusChanges &&
    TERMINAL_STATUSES.has(status) &&
    (await hasOpenChildren(tx, task.id))
  ) {
    throw new TaskError('TASK_HAS_OPEN_SUBTASKS', 'Open subtasks remain');
  }
  if (statusChanges) {
    await closePendingTaskReviewOnStatusLeave(tx, {
      task,
      toStatus: status,
      actor: { kind: 'system', actorId: args.actorId },
    });
    await cancelLiveAgentRunOnLeave(tx, task, status);
  }
  const now = Date.now();
  const archivedAt = args.archived ? (task.archivedAt ?? now) : null;
  if (statusChanges || archiveChanges) {
    const rank = statusChanges
      ? await computeEndRank(tx, task.projectId, status)
      : task.rank;
    await tx`
      UPDATE app.tasks SET status = ${status}, rank = ${rank},
        completed_at_ms = ${TERMINAL_STATUSES.has(status) ? (task.completedAt ?? now) : null},
        archived_at_ms = ${archivedAt}, updated_at_ms = ${now},
        status_changed_at_ms = ${statusChanges ? now : task.statusChangedAt}
      WHERE id = ${task.id} AND org_id = ${task.organizationId}
    `;
    if (statusChanges) {
      await settleTaskStatusChange(tx, {
        task,
        toStatus: status,
        actorType: 'agent',
        actorId: args.actorId,
        toArchivedAt: archivedAt,
        repeat: false,
        context: args.context,
        bell: !args.archived,
      });
    } else {
      await applyTaskCountTransition(
        tx,
        task.projectId,
        taskCountBucket(task),
        taskCountBucket({ status, archivedAt }),
      );
    }
    if (archiveChanges) {
      await recordActivity(tx, {
        task,
        actorType: 'agent',
        actorId: args.actorId,
        action: args.archived ? 'archived' : 'restored',
        context: args.context,
      });
    }
  }
  await recordActivity(tx, {
    task,
    actorType: 'agent',
    actorId: args.actorId,
    action: 'external_status.projected',
    toValue: status,
    context: args.context,
  });
}

/**
 * The agent kick every human door that lands a card at `in_progress` shares
 * (the status picker, the drag, and a card CREATED straight into the column):
 * an agent-owned task gets its queued run + `task.agent_turn` job in the same
 * transaction as the status write, attributed to the person whose gesture it
 * was. A task with no agent assignee, or whose agent is gone, kicks nothing.
 */
async function kickAssignedAgentRun(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  task: Pick<TaskRow, 'id' | 'projectId' | 'assigneeType' | 'assigneeId'>,
): Promise<void> {
  if (task.assigneeType !== 'agent' || task.assigneeId === null) return;
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
  if (!agent) return;
  await kickAgentRun(tx, {
    organizationId: auth.organizationId,
    projectId: task.projectId,
    taskId: task.id,
    agentId: agent.id,
    harness: agent.harness,
    model: agent.model,
    ...(agent.modelProvider !== null
      ? { modelProvider: agent.modelProvider }
      : {}),
    startedBy: auth.userId,
    ...(auth.apiKeyId !== undefined ? { apiKeyId: auth.apiKeyId } : {}),
    trigger: 'manual',
  });
}

/**
 * Leaving `in_progress` through a HUMAN door cancels the task's live agent
 * run: a person who closes, cancels or sends a card back has decided the
 * agent's work is over, and a run left grinding would park the card back at
 * In review on settle. The browser choreography cancels first and moves
 * anyway when that cancel fails; owning the rule here keeps every door (REST,
 * a stale client) honest. The exec itself is reaped by its next drive window
 * (the orphan check), exactly as after the cancel-live door.
 */
async function cancelLiveAgentRunOnLeave(
  tx: TransactionSql,
  task: Pick<TaskRow, 'id' | 'organizationId' | 'status'>,
  toStatus: TaskStatus,
): Promise<void> {
  if (task.status !== 'in_progress' || toStatus === 'in_progress') return;
  const live = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE task_id = ${task.id} AND org_id = ${task.organizationId}
      AND status IN ('queued', 'running')
    LIMIT 1
  `;
  const run = live[0];
  if (run === undefined) return;
  await cancelAgentRunInTx(tx, {
    organizationId: task.organizationId,
    runId: run.id,
    taskId: task.id,
  });
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
    /** `false` for a run a member started: it names only labels the
     * catalog already has, which stays its editors' to grow. */
    mintLabels?: boolean;
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
  const sentDescription = validateDescription(args.description);
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
      createIfMissing: args.mintLabels ?? true,
    })) ?? [];
  // An agent's description stores its mentions as whom they name, as a
  // person's does; it notifies nobody, as before.
  const description =
    sentDescription === undefined
      ? undefined
      : (
          await prepareSurfaceText(tx, {
            organizationId: args.organizationId,
            projectId: args.projectId,
            body: sentDescription,
            cap: TASK_DESCRIPTION_MAX,
            mode: 'full',
          })
        ).text;
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
    throw new Error('TASK_CREATE_FAILED: the insert answered no row');
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
  // The settle's park names its run, and may only move a card that is still
  // In progress FOR that run. A person or an automation who moved the card
  // meanwhile (closed it, cancelled it, sent it back) made a decision this
  // lane must not undo by yanking the card back to In review with its
  // completion stamp cleared and a fresh reviewer bell; and a run cancelled
  // while its last drive window was already draining must not park the card
  // either. The auto-retry job refuses the same way (`task_moved`).
  if (args.review !== undefined) {
    if (task.status !== 'in_progress') {
      return { ok: false, reason: 'TASK_MOVED' };
    }
    const live = await tx<{ id: string }[]>`
      SELECT id FROM app.project_agent_runs
      WHERE id = ${args.review.runId} AND task_id = ${args.taskId}
        AND org_id = ${args.organizationId}
        AND status IN ('queued', 'running')
      LIMIT 1
    `;
    if (live.length === 0) {
      return { ok: false, reason: 'RUN_NOT_LIVE' };
    }
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
  // A cancel here continues a repeating task like any close — audited as
  // the api actor's, with no `task.created` event (the settle's agent lane
  // is event-less). The copy is not answered, as the agent's tools and the
  // workflow native carry no repeat rules.
  await settleTaskStatusChange(tx, {
    task,
    toStatus: args.status,
    actorType: 'agent',
    actorId: args.actorId,
  });
  await mintReview();
  return { ok: true };
}

/** Lower half of the separately authorized, source-bound native review.
 * The review domain closes its exact approval in this same transaction.
 * Generic agent status tools still cannot complete tasks. This uses the
 * existing settle so rollups, bells and repeating copies cannot drift. */
export async function applyAgentTaskReviewStatusTrusted(
  tx: TransactionSql,
  args: { task: TaskRow; agentId: string; status: 'done' | 'todo' },
): Promise<void> {
  const { task, status } = args;
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskCreatable(project, {
    organizationId: task.organizationId,
    userId: args.agentId,
    role: 'admin',
    teamIds: [],
  });
  assertTaskNotArchived(task);
  if (task.status !== 'in_review') {
    throw new TaskError(
      'TASK_REVIEW_STALE',
      'The task is no longer in review',
      409,
    );
  }
  if (await taskHasLiveRun(tx, task)) {
    throw new TaskError(
      'TASK_REVIEW_BUSY',
      'A live run or question still holds this task',
      409,
    );
  }
  if (status === 'done') {
    if (await hasOpenChildren(tx, task.id)) {
      throw new TaskError('TASK_HAS_OPEN_SUBTASKS', 'Open subtasks remain');
    }
    if ((await openTaskBlockerIds(tx, task.id)).length > 0) {
      throw new TaskError(
        'TASK_REVIEW_BLOCKED',
        'An open dependency still blocks this task',
        409,
      );
    }
  }
  const now = Date.now();
  const rank = await computeEndRank(tx, task.projectId, status);
  await tx`
    UPDATE app.tasks SET
      status = ${status}, rank = ${rank},
      completed_at_ms = ${status === 'done' ? (task.completedAt ?? now) : null},
      updated_at_ms = ${now}, status_changed_at_ms = ${now}
    WHERE id = ${task.id} AND org_id = ${task.organizationId}
  `;
  await settleTaskStatusChange(tx, {
    task,
    toStatus: status,
    actorType: 'agent',
    actorId: args.agentId,
  });
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

/** Priority-only reuse of the normal edit writer. The caller has resolved
 * live project authority; the synthetic access context is never recorded as
 * a human actor, and cannot carry reviewer, description or other edit fields. */
export async function agentUpdateTaskPriorityTrusted(
  tx: TransactionSql,
  args: {
    organizationId: string;
    actorId: string;
    taskId: string;
    priority: TaskPriority | null;
  },
): Promise<void> {
  await updateTaskFields(
    tx,
    {
      organizationId: args.organizationId,
      userId: args.actorId,
      role: 'admin',
      teamIds: [],
    },
    { taskId: args.taskId, priority: args.priority },
    args.actorId,
  );
}

/**
 * TRUSTED agent-side hand-off to a project agent, or unassignment — the assignment half of a
 * start another agent or an automation asked for (`delegated-start.ts`), also
 * used by the guarded metadata tool without a start. The
 * caller resolved who may ask and checked the agent belongs to the task's
 * project; this is the picker's write with the asking agent (or the
 * `workflow` sentinel) as the actor: the assignee, the activity line, the
 * audit row (`viaAgent`, as the agent's other writes) and the assignment
 * bells. A live run holds the task for its current worker, so a transfer
 * under one is refused exactly as the picker refuses it — unless that run
 * still waits for a worker and never launched: then the transfer withdraws
 * it, as the picker's does.
 */
export async function agentAssignTaskToAgentTrusted(
  tx: TransactionSql,
  args: { task: TaskRow; agentId: string | null; actorId: string },
): Promise<void> {
  const { task } = args;
  const assignee: AssigneeRef | null =
    args.agentId === null
      ? null
      : {
          assigneeType: 'agent',
          assigneeId: args.agentId,
        };
  if (!assigneeChanges(task, assignee)) return;
  await withdrawWaitingAgentRunInTx(tx, task);
  if (await taskHasLiveRun(tx, task)) {
    throw new TaskError(
      'TASK_HAS_LIVE_RUN',
      'A live run holds this task; it cannot pass to another agent until that run ends',
      409,
    );
  }
  await tx`
    UPDATE app.tasks SET
      assignee_type = ${assignee?.assigneeType ?? null}, assignee_id = ${args.agentId},
      updated_at_ms = ${Date.now()}
    WHERE id = ${task.id}
  `;
  await recordActivity(tx, {
    task,
    actorType: 'agent',
    actorId: args.actorId,
    action: 'assignee.changed',
    ...(task.assigneeId !== null ? { fromValue: task.assigneeId } : {}),
    ...(args.agentId !== null ? { toValue: args.agentId } : {}),
  });
  await createAuditLog(tx, {
    organizationId: task.organizationId,
    actorId: args.actorId,
    actorType: 'api',
    action:
      assignee === null
        ? TASK_AUDIT_ACTIONS.unassigned
        : TASK_AUDIT_ACTIONS.assigned,
    category: 'data',
    resourceType: TASK_RESOURCE_TYPE,
    resourceId: task.id,
    resourceName: task.title,
    previousState: {
      assigneeType: task.assigneeType,
      assigneeId: task.assigneeId,
    },
    newState: {
      assigneeType: assignee?.assigneeType ?? null,
      assigneeId: args.agentId,
    },
    metadata: { viaAgent: true, projectId: task.projectId },
    status: 'success',
  });
  await notifyTaskAssigned(tx, {
    task,
    assigneeType: assignee?.assigneeType ?? null,
    assigneeId: args.agentId,
    actorType: 'agent',
    actorId: args.actorId,
    previousAssigneeType: task.assigneeType,
    previousAssigneeId: task.assigneeId,
  });
}

/**
 * Hand the card to In progress as the lower half of a start another agent
 * asked for — {@link handTaskToInProgressForKick}'s write with the asking
 * agent as the actor instead of a person: the move is recorded as the
 * agent's (event-less, like every agent-lane move), and a pending review is
 * WITHDRAWN, never approved — no person decided. Returns whether the card
 * actually moved.
 */
export async function agentHandTaskToInProgressTrusted(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string; actorId: string },
): Promise<boolean> {
  const fresh = await loadTaskOrThrow(tx, args.taskId, args.organizationId);
  if (fresh.status === 'in_progress') return false;
  await closePendingTaskReviewOnStatusLeave(tx, {
    task: fresh,
    toStatus: 'in_progress',
    actor: { kind: 'system', actorId: args.actorId },
  });
  const now = Date.now();
  const rank = await computeEndRank(tx, fresh.projectId, 'in_progress');
  await tx`
    UPDATE app.tasks SET
      status = 'in_progress', rank = ${rank}, completed_at_ms = NULL,
      status_changed_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${fresh.id}
  `;
  await settleTaskStatusChange(tx, {
    task: fresh,
    toStatus: 'in_progress',
    actorType: 'agent',
    actorId: args.actorId,
  });
  return true;
}

/** One deliverable in the task's Output zone. `runId` names the run that
 * produced it — the provenance ledger binds a run's entry to exactly the
 * outputs stamped with its id. */
export interface TaskOutputEntry {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  runId?: string;
}

/**
 * TRUSTED deliverables merge into the task's Output zone (same fileName ⇒
 * replace and move to the end) — the settle's attach step. Stored order tracks
 * the last write so the staging window includes re-delivered older names.
 */
export async function agentRecordTaskOutputsTrusted(
  tx: TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
    /** The producing run — stamped on every merged entry. */
    runId?: string;
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
  const next: TaskOutputEntry[] = Array.isArray(task.outputs)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the outputs column is written only by this shape
      ([...task.outputs] as TaskOutputEntry[])
    : [];
  for (const file of args.files) {
    const fileName = file.fileName.slice(0, 255);
    if (fileName === '') continue;
    const entry: TaskOutputEntry = {
      ...file,
      fileName,
      ...(args.runId !== undefined ? { runId: args.runId } : {}),
    };
    const at = next.findIndex((output) => output.fileName === fileName);
    if (at !== -1) next.splice(at, 1);
    next.push(entry);
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
  await assertTaskWorkable(tx, project, task, auth);
  assertTaskNotArchived(task);

  const assignee = normalizeAssignee(args);
  await assertAssigneeValid(tx, { project, auth, assignee });
  if (assignee?.assigneeType === 'app' && assigneeChanges(task, assignee)) {
    await assertAutomationForTask(tx, {
      project,
      auth,
      task,
      automation: assignee.assigneeId,
    });
  }
  // A live run holds the task for its current worker: transferring it
  // mid-flight would leave the old agent driving (settle comments, the
  // in_review park) a card that now shows someone else's name, and "Run
  // agent" answering already_running for the wrong agent. The refusal
  // names itself — the picker cancels the run first, then reassigns (its
  // confirmed-handoff flow). A run that still waits for a worker and never
  // launched has done nothing yet: the reassignment withdraws it instead.
  if (assigneeChanges(task, assignee)) {
    await withdrawWaitingAgentRunInTx(tx, task);
    if (await taskHasLiveRun(tx, task)) {
      throw new TaskError(
        'TASK_HAS_LIVE_RUN',
        'A live run holds this task; cancel it before reassigning',
        409,
      );
    }
  }

  await tx`
    UPDATE app.tasks SET
      assignee_type = ${assignee?.assigneeType ?? null},
      assignee_id = ${assignee?.assigneeId ?? null},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.taskId}
  `;
  await settleTaskAssigneeChange(tx, { task, assignee, auth });
  // Handed to an automation, the task follows its lifecycle: the series
  // ends here rather than hiding behind a Repeat row nobody can reach.
  await endRepeatForAutomationOwner(tx, {
    task,
    next: {
      assigneeType: assignee?.assigneeType ?? null,
      assigneeId: assignee?.assigneeId ?? null,
    },
    actorType: 'user',
    actorId: auth.userId,
  });
}

/** Board drag: move to (status, position) — rank between the neighbour
 * CARDS (the 0.4 wire sends task ids; ranks resolve here). Answers the next
 * copy when the drop closed a repeating task. */
export async function moveTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    taskId: string;
    status: TaskStatus;
    beforeTaskId?: string;
    afterTaskId?: string;
  },
): Promise<TaskRepeatCopy | null> {
  const task = await loadTaskOrThrow(tx, args.taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertTaskWorkable(tx, project, task, auth);
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
    await cancelLiveAgentRunOnLeave(tx, task, args.status);
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
  if (!statusChanges) return null;
  // The drag is the same status door as the picker: it bells the
  // subscribers and fires the org's triggers through the shared seam.
  const nextTask = await settleTaskStatusChange(tx, {
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
  return nextTask;
}

export async function archiveTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertTaskWorkable(tx, project, task, auth);
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
  await assertTaskWorkable(tx, project, task, auth);
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
 *
 * Nothing the subtree owned outlives it — the live-run cancel, the thread
 * delete, the approval close, the row delete and the blob release are the
 * shared retirement walk (`retire.ts` `retireTasksInTx`), which the project
 * door runs over ITS tasks too. This door adds the project rollup
 * transitions (the project survives its task) and the audit row.
 *
 * Working a task is not enough to delete it, even for the person who created
 * it: the subtree, its discussion and its files can hold other people's
 * work, which archiving keeps and a delete does not. Editors and a task's
 * own creator or assignee archive; owners and admins delete.
 */
export async function deleteTask(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ deletedChildCount: number }> {
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertTaskWorkable(tx, project, task, auth);
  if (!['owner', 'admin'].includes(auth.role)) {
    throw new TaskError('ROLE_FORBIDDEN', 'Admin role required', 403);
  }
  const tree = await tx<
    { id: string; status: TaskStatus; archivedAt: number | null }[]
  >`
    WITH RECURSIVE tree AS (
      SELECT id, status, archived_at_ms
      FROM app.tasks WHERE id = ${taskId}
      UNION
      SELECT t.id, t.status, t.archived_at_ms
      FROM app.tasks t JOIN tree ON t.parent_task_id = tree.id
      WHERE t.org_id = ${auth.organizationId}
        AND t.project_id = ${task.projectId}
    )
    SELECT id, status, archived_at_ms::float8 AS "archivedAt"
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
  const retired = await retireTasksInTx(tx, {
    organizationId: auth.organizationId,
    projectId: task.projectId,
    taskIds: ids,
    closedReason: 'task_deleted',
  });

  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.deleted, {
      previousState: { status: task.status, title: task.title },
      metadata: {
        deletedChildCount: ids.length - 1,
        cancelledRunCount: retired.cancelledRunCount,
        releasedBlobRefCount: retired.releasedRefs.length,
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
  // "Blocked by" is the blocked task's own record — its activity line and
  // its Blocked chip — so the edge is a change to that task.
  await assertTaskWorkable(tx, project, blocked, auth);
  // An archived task takes no new edge on either end, as on the board: an
  // archived blocker's status no longer moves, so it would block for good.
  assertTaskNotArchived(blocked);
  assertTaskNotArchived(blocker);

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
  // The edge is the blocked task's record, as when it was added: an archived
  // one keeps its edges, while an archived BLOCKER can still be dropped from
  // an active task, the one way to free it.
  await assertTaskWorkable(tx, project, blocked, auth);
  assertTaskNotArchived(blocked);
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

/** A board row decorated for the wire, as {@link DecoratedTaskRow}. */
export type DecoratedBoardTaskRow = BoardTaskRow &
  Pick<DecoratedTaskRow, 'labels' | 'folderExists' | 'hasFiles' | 'projectKey'>;

export interface TaskListFilters {
  includeArchived?: boolean;
  status?: string;
  statuses?: string[];
  assigneeId?: string;
  /** The person named to review the task's result (`reviewer_user_id`). */
  reviewerId?: string;
  externalSystem?: string;
  /** The toolbar's search: the palette's token-AND match, applied with the
   * other filters before the board's cap rather than after a capped search
   * (#3745). Blank matches everything. */
  query?: string;
}

export interface TaskBoardReadOptions extends TaskListFilters {
  /** Boards omit long bodies by default; false keeps the full compatibility
   * read. Task details always use the full projection. */
  summary?: boolean;
}

interface TaskFolderFacts {
  existingFolders: Set<string>;
  foldersWithFiles: Set<string>;
}

const NO_FOLDER_FACTS: TaskFolderFacts = {
  existingFolders: new Set(),
  foldersWithFiles: new Set(),
};

/** Batch-resolve the page's label ids to catalog DTOs (color derived, the
 * 0.4 rule — the catalog stores names, the palette is deterministic). */
async function resolveLabelMap(
  sql: Sql,
  tasks: readonly Pick<TaskRow, 'labelIds'>[],
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
  tasksByProject: ReadonlyMap<
    string,
    readonly Pick<BoardTaskRow, 'externalId'>[]
  >,
): Promise<Map<string, TaskFolderFacts>> {
  const folderIds: string[] = [];
  const projectIds: string[] = [];
  for (const [projectId, tasks] of tasksByProject) {
    const roots = new Set(tasks.map((task) => task.externalId));
    for (const root of roots) {
      if (root === null) continue;
      folderIds.push(root);
      projectIds.push(projectId);
    }
  }
  if (folderIds.length === 0) {
    return new Map();
  }
  const rows = await sql<
    { rootId: string; projectId: string; hasFiles: boolean }[]
  >`
    WITH RECURSIVE tree AS (
      SELECT f.id AS root_id, f.project_id, f.id, 0 AS depth
      FROM app.folders f
      JOIN unnest(${folderIds}::text[], ${projectIds}::text[])
        AS roots(id, project_id)
        ON f.id = roots.id AND f.project_id = roots.project_id
      WHERE f.org_id = ${organizationId}
      UNION ALL
      SELECT t.root_id, t.project_id, f.id, t.depth + 1
      FROM app.folders f
      JOIN tree t ON f.parent_id = t.id
      WHERE t.depth < 16
        AND f.org_id = ${organizationId}
        AND f.project_id = t.project_id
    )
    SELECT root_id AS "rootId",
           project_id AS "projectId",
           bool_or(EXISTS (
             SELECT 1 FROM app.documents d
             WHERE d.folder_id = tree.id
               AND d.org_id = ${organizationId}
               AND d.file_ref IS NOT NULL
               AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
           )) AS "hasFiles"
    FROM tree
    GROUP BY root_id, project_id
  `;
  const facts = new Map<string, TaskFolderFacts>();
  for (const row of rows) {
    let project = facts.get(row.projectId);
    if (project === undefined) {
      project = { existingFolders: new Set(), foldersWithFiles: new Set() };
      facts.set(row.projectId, project);
    }
    project.existingFolders.add(row.rootId);
    if (row.hasFiles) project.foldersWithFiles.add(row.rootId);
  }
  return facts;
}

function decorateTaskRow<Row extends BoardTaskRow>(
  task: Row,
  labelMap: ReadonlyMap<string, ResolvedTaskLabel>,
  facts: { existingFolders: Set<string>; foldersWithFiles: Set<string> },
): Row & Pick<DecoratedTaskRow, 'labels' | 'folderExists' | 'hasFiles'> {
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

async function decorateProjectPage<Row extends BoardTaskRow>(
  sql: Sql,
  organizationId: string,
  projectId: string,
  tasks: Row[],
): Promise<
  (Row & Pick<DecoratedTaskRow, 'labels' | 'folderExists' | 'hasFiles'>)[]
> {
  const labelMap = await resolveLabelMap(sql, tasks);
  const facts = await collectFolderFacts(
    sql,
    organizationId,
    new Map([[projectId, tasks]]),
  );
  return tasks.map((task) =>
    decorateTaskRow(task, labelMap, facts.get(projectId) ?? NO_FOLDER_FACTS),
  );
}

/**
 * The shared board filter clause over `t`, the `app.tasks` row (each filter
 * optional, ANDed). A search is one of these filters, so it narrows the same
 * statement that carries the board's `LIMIT`: every match stays reachable,
 * whatever the other filters leave.
 */
function boardFilterClause(sql: Sql, filters: TaskListFilters) {
  const includeArchived = filters.includeArchived ?? false;
  const status = filters.status ?? null;
  const statuses = filters.statuses ?? null;
  const assigneeId = filters.assigneeId ?? null;
  const reviewerId = filters.reviewerId ?? null;
  const externalSystem = filters.externalSystem ?? null;
  const patterns = taskSearchPatterns(filters.query ?? '');
  return sql`
    (${includeArchived} OR t.archived_at_ms IS NULL)
    AND (${status}::text IS NULL OR t.status = ${status})
    AND (${statuses === null} OR t.status = ANY(${statuses ?? []}))
    AND (${assigneeId}::text IS NULL OR t.assignee_id = ${assigneeId})
    AND (${reviewerId}::text IS NULL OR EXISTS (
      SELECT 1 FROM app.approvals r
      WHERE r.org_id = t.org_id AND r.resource_type = 'task_review'
        AND r.resource_id = t.id AND r.status = 'pending'
        AND r.wf_execution_id IS NULL
        AND CASE WHEN r.metadata ? 'reviewer' THEN
          CASE WHEN r.metadata -> 'reviewer' ->> 'kind' = 'user'
            THEN r.metadata -> 'reviewer' ->> 'userId' ELSE NULL END
          ELSE r.metadata ->> 'requestedFor' END = ${reviewerId}
    ) OR (
      t.reviewer_user_id = ${reviewerId} AND NOT EXISTS (
        SELECT 1 FROM app.approvals r
        WHERE r.org_id = t.org_id AND r.resource_type = 'task_review'
          AND r.resource_id = t.id AND r.status = 'pending'
          AND r.wf_execution_id IS NULL
      )
    ))
    AND (${externalSystem}::text IS NULL OR t.external_system = ${externalSystem})
    ${patterns.length > 0 ? sql`AND ${taskSearchMatch(sql, patterns)}` : sql``}
  `;
}

export async function listTasksByProject(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
  filters: TaskBoardReadOptions = {},
): Promise<
  {
    tasks: DecoratedBoardTaskRow[];
    truncated: boolean;
  } & TaskAccess
> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  const access = boardTaskAccess(project, auth);
  const rows = await sql<BoardTaskRow[]>`
    SELECT ${sql.unsafe(filters.summary === false ? TASK_COLUMNS : BOARD_TASK_COLUMNS)} FROM app.tasks t
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
    ...access,
  };
}

/** The most rows one `task_find` read returns. The tool pages its answer
 * (`workspace_domain_tools.ts` asks for a page and one row more), so this
 * only bounds a single statement. */
const AGENT_TASK_LIST_CAP = 200;

/**
 * The orders `task_find` walks in. `board` groups the tasks by status, in
 * the order of the status names (backlog, cancelled, done, in_progress,
 * in_review, todo), and keeps each column's own order (its rank) within a
 * status; `created` is the order the tasks were made in, oldest first, and a
 * task's place in it never changes. Both end on the task id, so tasks tied on
 * rank or on their creation millisecond still have exactly one order, and a
 * page that ends inside a tie resumes after the row it ended on.
 */
export type AgentTaskListOrder = 'board' | 'created';

/** The sort key of the last row a `task_find` page answered — where the next
 * page starts, exclusive. */
export type AgentTaskListPosition =
  | { order: 'board'; status: TaskStatus; rank: string; id: string }
  | { order: 'created'; createdAt: number; id: string };

/**
 * The `task_find` read — undecorated rows for an agent, NOT a board page.
 * Authority is resolved before this call (`resolveSessionActionContext`), so
 * the project set arrives as an argument: one project for a project-bound run,
 * its automation's bound set for an org-wide one, and nothing at all for a
 * truly org-level run, which reads the whole organization. Labels and folder
 * facts are skipped — the model reads titles and status, not chips.
 *
 * A keyset page: the rows strictly after `after` in `order`, at most `limit`
 * of them. Each page reads the board as it stands, never a snapshot of the
 * first one — see {@link AgentTaskListOrder} for what a move between pages
 * does to a walk.
 */
export async function listTasksForAgent(
  sql: Sql,
  args: {
    organizationId: string;
    projectId?: string;
    projectIds?: string[];
    status?: TaskStatus;
    assigneeId?: string;
    reviewerAgentId?: string;
    includeArchived?: boolean;
    order?: AgentTaskListOrder;
    after?: AgentTaskListPosition;
    limit?: number;
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
  // A position carries the order it was taken in, so a later page always
  // continues the order its first page was read in.
  const after = args.after;
  const order = after?.order ?? args.order ?? 'board';
  const limit =
    args.limit !== undefined && Number.isFinite(args.limit)
      ? Math.min(Math.max(Math.floor(args.limit), 1), AGENT_TASK_LIST_CAP)
      : AGENT_TASK_LIST_CAP;
  const rows = await sql<TaskRow[]>`
    SELECT ${sql.unsafe(TASK_COLUMNS)} FROM app.tasks t
    WHERE org_id = ${args.organizationId}
      AND (${scoped === null} OR project_id = ANY(${scoped ?? []}))
      AND ${boardFilterClause(sql, filters)}
      AND ${
        args.reviewerAgentId === undefined
          ? sql`TRUE`
          : sql`(
              SELECT a.metadata -> 'reviewer' FROM app.approvals a
              WHERE a.resource_id = t.id AND a.org_id = t.org_id
                AND a.resource_type = 'task_review' AND a.status = 'pending'
                AND a.wf_execution_id IS NULL
              ORDER BY a.seq DESC LIMIT 1
            ) = jsonb_build_object('kind', 'agent', 'agentId', ${args.reviewerAgentId}::text)`
      }
      AND ${
        after === undefined
          ? sql`TRUE`
          : after.order === 'created'
            ? sql`(t.created_at_ms, t.id)
                  > (${after.createdAt}::bigint, ${after.id}::text)`
            : sql`(t.status, t.rank, t.id)
                  > (${after.status}::text, ${after.rank}::text, ${after.id}::text)`
      }
    ORDER BY ${
      order === 'created'
        ? sql`t.created_at_ms ASC, t.id ASC`
        : sql`t.status ASC, t.rank ASC, t.id ASC`
    }
    LIMIT ${limit}
  `;
  return [...rows];
}

/**
 * All-projects board: every task in projects the caller can read (newest
 * activity first, then re-grouped (status, rank) — the 0.4 walk), each row
 * stamped with its project's key so cards can render `KEY-123` without a
 * second lookup. The access flags are role-level — an editor role edits
 * every project it can read, and every member creates in them and works
 * their own tasks (the list holds active projects only); the per-write
 * gates stay server-side.
 */
export async function listTasksForAccessibleProjects(
  sql: Sql,
  auth: ProjectAuthContext,
  filters: TaskBoardReadOptions = {},
): Promise<
  {
    tasks: DecoratedBoardTaskRow[];
    truncated: boolean;
  } & TaskAccess
> {
  const projects = await listProjects(sql, auth, { summary: true });
  const access: TaskAccess = {
    canEdit: EDITOR_ROLES.has(auth.role),
    canCreate: auth.role !== 'disabled',
  };
  if (projects.length === 0) {
    return { tasks: [], truncated: false, ...access };
  }
  const projectKeys = new Map(
    projects.map((project) => [project.id, project.key]),
  );
  const rows = await sql<BoardTaskRow[]>`
    SELECT ${sql.unsafe(filters.summary === false ? TASK_COLUMNS : BOARD_TASK_COLUMNS)} FROM app.tasks t
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
      ? compareRank(a.rank, b.rank)
      : a.status.localeCompare(b.status),
  );

  // Folder facts are per-project — group the page, stamp, then merge.
  const labelMap = await resolveLabelMap(sql, page);
  const byProject = new Map<string, BoardTaskRow[]>();
  for (const task of page) {
    const group = byProject.get(task.projectId);
    if (group) group.push(task);
    else byProject.set(task.projectId, [task]);
  }
  const facts = await collectFolderFacts(sql, auth.organizationId, byProject);
  return {
    tasks: page.map((task) => {
      const key = projectKeys.get(task.projectId) ?? null;
      const decorated = decorateTaskRow(
        task,
        labelMap,
        facts.get(task.projectId) ?? NO_FOLDER_FACTS,
      );
      return key !== null
        ? Object.assign(decorated, { projectKey: key })
        : decorated;
    }),
    truncated,
    ...access,
  };
}

export async function getTask(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<
  {
    task: DecoratedTaskRow;
    canComment: boolean;
    /** The owners up the task's subtask tree, nearest parent first — the
     * sheet decides with them whether the viewer may work a subtask. */
    ancestors: TaskOwnership[];
  } & TaskAccess
> {
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  const access = boardTaskAccess(project, auth);
  const ancestors =
    task.parentTaskId === null
      ? []
      : await loadTaskAncestry(sql, auth.organizationId, task.parentTaskId);
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
    ...access,
    // Reaching here means the caller passed the project read gate — exactly
    // the requirement to comment (a READ-level action, the 0.4 posture) — on
    // an active task in an active project, which every comment door
    // requires; the composer and the comment actions follow this flag.
    canComment: project.archivedAt === null && task.archivedAt === null,
    ancestors,
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

/**
 * How much of a changed description the activity read carries. The row keeps
 * both whole descriptions (up to 20,000 characters each) and the timeline
 * quotes a line's length of them, so a task edited a few dozen times answered
 * megabytes of text nobody reads, on every open and every refresh.
 */
const ACTIVITY_DESCRIPTION_QUOTE_MAX = 1000;

export async function listTaskActivity(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
  limit = 100,
): Promise<TaskActivityRow[]> {
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  const rows = await sql<TaskActivityRow[]>`
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
  // The rows are this read's own, fresh from the query: quoted in place.
  for (const row of rows) {
    if (row.action === 'description.changed') {
      row.fromValue = quoteDescription(row.fromValue);
      row.toValue = quoteDescription(row.toValue);
    }
  }
  return rows;
}

/** The head of a description, never cut inside a character or inside a
 * mention, whose reader would otherwise show half its address. */
function quoteDescription(value: string | null): string | null {
  if (value === null || value.length <= ACTIVITY_DESCRIPTION_QUOTE_MAX) {
    return value;
  }
  const end = ACTIVITY_DESCRIPTION_QUOTE_MAX;
  // A high surrogate at the cut opens a pair the cut would split.
  const code = value.charCodeAt(end - 1);
  return cutTaskText(value, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
}

// ---------------------------------------------------------------------------
// Search (the palette, and the board's `query` filter)
// ---------------------------------------------------------------------------

const SEARCH_MAX_RESULTS = 25;
const SEARCH_SNIPPET_MAX = 600;
/** How much of a text a snippet is read from: room for its 600 characters
 * once markdown and mentions are read, without parsing a whole description
 * of up to 20,000 characters for every hit of every palette query. */
const SEARCH_SNIPPET_SOURCE_MAX = SEARCH_SNIPPET_MAX * 4;

/** The head of a text a snippet is read from. A cut through a mention link
 * drops that mention instead of leaving its address to be read as text. */
function searchSnippetSource(text: string): string {
  if (text.length <= SEARCH_SNIPPET_SOURCE_MAX) return text;
  const head = text.slice(0, SEARCH_SNIPPET_SOURCE_MAX);
  const open = head.lastIndexOf('[@');
  if (open === -1 || /\]\(mention:[^)\s]*\)/.test(head.slice(open))) {
    return head;
  }
  return head.slice(0, open);
}

/**
 * A search query's `LIKE ALL` patterns: its whitespace-separated tokens,
 * lowercased, each one's `LIKE` metacharacters escaped. None for a blank
 * query. The palette and the board search with the same patterns, so one
 * query finds the same tasks through either.
 */
export function taskSearchPatterns(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => `%${token.replaceAll(/([%_\\])/g, String.raw`\$1`)}%`);
}

/**
 * A task's own fields hold every token: title, description, external id and
 * `KEY-number`, read together. `t` is the `app.tasks` row. A mention in the
 * description counts by the name it was saved with, never by its address
 * (`mention:agent/<id>`), so "agent" does not find every task that mentions
 * one; a mention of someone renamed since is found by the older name only.
 */
function taskFieldsSearchMatch(sql: Sql, patterns: string[]) {
  return sql`lower(
    t.title || ' ' ||
    regexp_replace(coalesce(t.description, ''), ${MENTION_URL_SQL_PATTERN},
                   ']', 'g') || ' ' ||
    coalesce(t.external_id, '') || ' ' ||
    coalesce(
      (SELECT p.key FROM app.projects p WHERE p.id = t.project_id) || '-' ||
        t.number::text,
      ''
    )
  ) LIKE ALL(${patterns})`;
}

/** One discussion comment holds every token; `m` is its `app.messages` row.
 * Its mentions count by name, as in {@link taskFieldsSearchMatch}. */
function commentSearchMatch(sql: Sql, patterns: string[]) {
  return sql`lower(regexp_replace(coalesce(m.text, ''), ${MENTION_URL_SQL_PATTERN}, ']', 'g')) LIKE ALL(${patterns})`;
}

/**
 * The board's search filter on `t`: the task's own fields hold every token,
 * or one comment on it does — the palette's two legs, judged row by row and
 * never capped, so the board's filters and `LIMIT` see every match.
 */
function taskSearchMatch(sql: Sql, patterns: string[]) {
  return sql`(
    ${taskFieldsSearchMatch(sql, patterns)}
    OR EXISTS (
      SELECT 1 FROM app.task_discussion_message_meta meta
      JOIN app.messages m ON m.id = meta.message_id
      WHERE meta.task_id = t.id AND meta.org_id = t.org_id
        AND ${commentSearchMatch(sql, patterns)}
    )
  )`;
}

export interface TaskSearchHit {
  taskId: string;
  projectId: string;
  title: string;
  /** Where the task stands — the palette shows it the way Home does. */
  status: TaskStatus;
  snippet: string;
  updatedAt: number;
  number?: number;
  projectKey?: string;
  /** The task itself is archived. Omitted when false (the #3007 shape). */
  archived?: true;
  /** The task's project is archived; the task may still be live work. */
  projectArchived?: true;
}

/**
 * The palette's search: token-AND over the field haystack (title +
 * description + externalId + `KEY-number`), with a comment-body fallback for
 * tasks whose fields don't match (the 0.4 walk; unbounded here — SQL searches
 * the whole visible set instead of the newest-80 window Convex's read limits
 * forced), answering the first page of hits. The board filters by the same
 * two legs uncapped (`TaskListFilters.query`).
 */
export async function searchTasks(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { query: string; projectId?: string },
): Promise<TaskSearchHit[]> {
  const patterns = taskSearchPatterns(args.query);
  if (patterns.length === 0) return [];

  let projectIds: string[];
  const projectKeys = new Map<string, string | null>();
  // #2999: archived work stays searchable and says it is archived. An archived
  // project is read here so its live tasks are findable at all, and its id is
  // kept so every hit from it can carry `projectArchived`.
  const archivedProjectIds = new Set<string>();
  if (args.projectId !== undefined) {
    const project = await loadProjectOrThrow(sql, args.projectId);
    assertTaskReadable(project, auth);
    projectIds = [project.id];
    projectKeys.set(project.id, project.key);
    if (project.archivedAt !== null) archivedProjectIds.add(project.id);
  } else {
    const projects = await listProjects(sql, auth, { includeArchived: true });
    projectIds = projects.map((project) => project.id);
    for (const project of projects) {
      projectKeys.set(project.id, project.key);
      if (project.archivedAt !== null) archivedProjectIds.add(project.id);
    }
  }
  if (projectIds.length === 0) return [];

  interface FieldHit {
    taskId: string;
    projectId: string;
    title: string;
    status: TaskStatus;
    description: string | null;
    updatedAt: number;
    number: number | null;
    archivedAt: number | null;
  }
  const fieldHits = await sql<FieldHit[]>`
    SELECT t.id AS "taskId", t.project_id AS "projectId", t.title, t.status,
           t.description, t.updated_at_ms::float8 AS "updatedAt", t.number,
           t.archived_at_ms::float8 AS "archivedAt"
    FROM app.tasks t
    WHERE t.org_id = ${auth.organizationId}
      AND t.project_id = ANY(${projectIds})
      AND ${taskFieldsSearchMatch(sql, patterns)}
    ORDER BY (t.archived_at_ms IS NOT NULL), t.updated_at_ms DESC
    LIMIT ${SEARCH_MAX_RESULTS}
  `;
  const seen = new Set(fieldHits.map((hit) => hit.taskId));

  // A snippet reads each mention as the CURRENT name of whoever it names,
  // and is cut after that, so it never ends in half a mention.
  let names: Map<string, string> = new Map();
  const toHit = (hit: FieldHit, snippetSource: string): TaskSearchHit => {
    const key = projectKeys.get(hit.projectId) ?? null;
    const row: TaskSearchHit = {
      taskId: hit.taskId,
      projectId: hit.projectId,
      title: hit.title,
      status: hit.status,
      snippet: taskMentionPlainText(searchSnippetSource(snippetSource), names)
        .trim()
        .slice(0, SEARCH_SNIPPET_MAX),
      updatedAt: hit.updatedAt,
    };
    if (hit.number !== null) row.number = hit.number;
    if (key !== null) row.projectKey = key;
    if (hit.archivedAt !== null) row.archived = true;
    if (archivedProjectIds.has(hit.projectId)) row.projectArchived = true;
    return row;
  };
  names = await currentMentionNames(
    sql,
    auth.organizationId,
    fieldHits.flatMap((hit) =>
      hit.description === null ? [] : [searchSnippetSource(hit.description)],
    ),
  );
  const results: TaskSearchHit[] = fieldHits.map((hit) =>
    toHit(hit, hit.description ?? hit.title),
  );

  if (results.length < SEARCH_MAX_RESULTS) {
    const commentHits = await sql<(FieldHit & { body: string })[]>`
      SELECT DISTINCT ON ((t.archived_at_ms IS NOT NULL), t.updated_at_ms, t.id)
             t.id AS "taskId", t.project_id AS "projectId", t.title, t.status,
             t.description, t.updated_at_ms::float8 AS "updatedAt", t.number,
             t.archived_at_ms::float8 AS "archivedAt",
             m.text AS body
      FROM app.task_discussion_message_meta meta
      JOIN app.messages m ON m.id = meta.message_id
      JOIN app.tasks t ON t.id = meta.task_id
      WHERE meta.org_id = ${auth.organizationId}
        AND t.project_id = ANY(${projectIds})
        AND ${commentSearchMatch(sql, patterns)}
      ORDER BY (t.archived_at_ms IS NOT NULL), t.updated_at_ms DESC, t.id,
               m.created_at_ms DESC
      LIMIT ${SEARCH_MAX_RESULTS}
    `;
    names = await currentMentionNames(
      sql,
      auth.organizationId,
      commentHits.map((hit) => searchSnippetSource(hit.body)),
    );
    for (const hit of commentHits) {
      if (results.length >= SEARCH_MAX_RESULTS) break;
      if (seen.has(hit.taskId)) continue;
      seen.add(hit.taskId);
      results.push(toHit(hit, hit.body));
    }
    results.sort(
      (a, b) =>
        Number(a.archived ?? false) - Number(b.archived ?? false) ||
        b.updatedAt - a.updatedAt,
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mention trigger preview (the composers' @-mention hint)
// ---------------------------------------------------------------------------

export interface MentionTriggerPreviewRow {
  slug: string;
  willTrigger: boolean;
  reason:
    | 'ok'
    | 'pack_disabled'
    | 'breaker_paused'
    | 'not_permitted'
    | 'standard_agent_unavailable';
}

/**
 * Per mentioned agent slug: would saving put it to work — and if not, why.
 * The 0.4 gate set minus the run-breaker leg (`breaker_paused` stays in the
 * union for shape stability; the pg task row has no pause bookkeeping yet),
 * plus the dispatcher's own work gate: on a task the viewer may not work,
 * the mention stays a plain one (`not_permitted`) — except for the agent
 * whose live run the viewer started, which their comment still steers. A
 * new task's description (a project target) is its creator's, who may work
 * it.
 */
export async function mentionTriggerPreview(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { taskId?: string; projectId?: string; slugs: string[] },
): Promise<MentionTriggerPreviewRow[]> {
  const slugs = [...new Set(args.slugs)].slice(0, 10);
  if (slugs.length === 0) return [];

  let project: ProjectRow;
  let task: TaskRow | undefined;
  if (args.taskId !== undefined) {
    task = await loadTaskOrThrow(sql, args.taskId, auth.organizationId);
    project = await loadProjectOrThrow(sql, task.projectId);
  } else if (args.projectId !== undefined) {
    project = await loadProjectOrThrow(sql, args.projectId);
  } else {
    throw new TaskError('INVALID_ARGUMENTS', 'taskId or projectId required');
  }
  assertTaskReadable(project, auth);
  // On a task the viewer may not work, only the agent whose running run
  // they started would hear them (a steer); every other mention stays plain.
  let steerableAgentId: string | undefined;
  const restricted =
    task !== undefined && !(await mayWorkTask(sql, project, task, auth));
  if (task !== undefined && restricted) {
    const live = await liveAgentRunOfTask(sql, task.id);
    if (live?.status === 'running' && live.startedBy === auth.userId) {
      steerableAgentId = live.agentId;
    }
  }

  const automationPolicy = await readGovernancePolicyForOrg(
    sql,
    auth.organizationId,
    'task_automation',
  );
  const packEnabled = automationPolicy?.enabled !== false;
  // The organization's standard agent answers only while it can start for
  // the person mentioning it — switched on, with a model they may use — as
  // the mention lane itself decides (`isStandardAgentRefusal`).
  const standardAgents = await sql<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE project_id = ${project.id} AND managed AND id IN ${sql(slugs)}
  `;
  const standardAgentRuns =
    standardAgents.length === 0 ||
    (await readStandardAgentAvailability(sql, {
      organizationId: auth.organizationId,
      userId: auth.userId,
    }).then(
      (availability) => availability.available,
      (error: unknown) => {
        console.warn(
          '[tasks] mention preview could not read the standard agent',
          error,
        );
        return false;
      },
    ));
  const standardAgentIds = new Set(standardAgents.map((agent) => agent.id));

  return slugs.map((slug) => {
    if (restricted && slug !== steerableAgentId) {
      return { slug, willTrigger: false, reason: 'not_permitted' as const };
    }
    if (!packEnabled) {
      return { slug, willTrigger: false, reason: 'pack_disabled' as const };
    }
    if (standardAgentIds.has(slug) && !standardAgentRuns) {
      return {
        slug,
        willTrigger: false,
        reason: 'standard_agent_unavailable' as const,
      };
    }
    return { slug, willTrigger: true, reason: 'ok' as const };
  });
}

/** The task's live agent run (queued or running), with its starter — the
 * person who may stop and steer it even once the task is no longer theirs. */
export async function liveAgentRunOfTask(
  sql: Sql | TransactionSql,
  taskId: string,
): Promise<
  { id: string; agentId: string; status: string; startedBy: string } | undefined
> {
  const rows = await sql<
    { id: string; agentId: string; status: string; startedBy: string }[]
  >`
    SELECT id, agent_id AS "agentId", status, started_by AS "startedBy"
    FROM app.project_agent_runs
    WHERE task_id = ${taskId} AND status IN ('queued', 'running')
    ORDER BY started_at_ms DESC
    LIMIT 1
  `;
  return rows[0];
}

/** Whether any run family holds this task live (agent turn or automation). */
export async function taskHasLiveRun(
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
 * `taskHasLiveRun`, for lanes that treat the two families differently (the
 * mention dispatcher steers an agent run but yields entirely to an
 * automation). An org-level run may carry this same task subject without a
 * project binding; a different non-NULL project never holds it here. */
async function taskHasLiveAutomationRun(
  tx: TransactionSql,
  task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>,
): Promise<boolean> {
  const automation = await tx<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE org_id = ${task.organizationId}
      AND (project_id = ${task.projectId} OR project_id IS NULL)
      AND status IN ('queued', 'running', 'waiting', 'quarantined')
      AND input -> 'task' ->> 'id' = ${task.id}
    LIMIT 1
  `;
  return automation.length > 0;
}

// ---------------------------------------------------------------------------
// Mention dispatch (what an @agent in a comment or a description sets off)
// ---------------------------------------------------------------------------

/**
 * @mentions in a task DESCRIPTION fan out the way a comment's do (the 0.4
 * `fanOutDescriptionMentions`): a named project agent is put to work through
 * the comment lane's dispatcher, under the task automation switch the
 * composer's trigger chips preview (`mentionTriggerPreview`), and the named
 * humans follow the task and get the mention bell. On create every mention
 * is new; an edit passes the text it replaces, and only the mentions it adds
 * fan out. An automation named here starts nothing: the chips preview
 * agents only, and a workflow reads its task's description when it runs.
 */
async function fanOutDescriptionMentions(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    taskId: string;
    project: ProjectRow;
    /** The description as stored. */
    description: string;
    /** Who the text names that it did not before (`prepareSurfaceText`): on
     * create, everyone it names. */
    added: ResolvedMention[];
  },
): Promise<void> {
  const added = args.added;
  if (added.length === 0) return;
  const task = await loadTaskOrThrow(tx, args.taskId, auth.organizationId);
  await dispatchMentionedProjectAgent(tx, {
    auth,
    task,
    project: args.project,
    mentions: added,
    authorType: 'user',
    authorId: auth.userId,
    text: args.description,
    source: 'description',
  });
  await notifyTaskMentions(tx, {
    task,
    mentions: added,
    actorType: 'user',
    actorId: auth.userId,
  });
}

/**
 * The @mention work dispatcher for the project's agent INSTANCES — the 0.4
 * `triggerMentionedProjectAgent` wire, shared by the two texts that name
 * someone on a task: a posted comment, and the description (on create, and
 * the mentions an edit adds). `text` is that text and `source` says which
 * it is. The FIRST mentioned instance belonging to THIS project picks the
 * lane:
 *
 * - the task's live run is RUNNING and its agent is mentioned → STEER the
 *   live turn with the text (the steer host injects it over the harness's
 *   held-open stdin, or restarts the exec around it), phrased by its source;
 * - the live run is QUEUED → nothing: its start reads the brief AFTER this
 *   write commits;
 * - another engine holds the task (a different instance's live run, a live
 *   automation run) → nothing: a mention adds work, never preempts it, and
 *   it never reassigns under a live run;
 * - the task is idle → (re)assign it to the instance when it isn't the
 *   assignee yet (`assignTask` — the picker's own choreography) and kick a
 *   fresh 'mention' run; the kick moves the card to In progress. A comment
 *   rides the run as its feedback. A description does not: the run reads
 *   it as it stands when it starts, so an edit made while the run waits is
 *   never contradicted by the text it replaced (a resumed conversation,
 *   which does not re-read the brief, is handed that current text).
 *
 * Every refusal is quiet — the text is saved and its humans are notified
 * either way. The gate is the task's work gate ({@link mayWorkTask}):
 * commenting is read-level, but assigning and running are changes to the
 * task, so the `@` of someone who may not work it — a member on another
 * person's task — stays a plain mention. The one exception is the live
 * run's own starter, who may steer it even once the task is no longer
 * theirs (handing an assigned task to an agent makes the agent its
 * assignee). Only a HUMAN's text dispatches — an agent's own comment naming
 * itself would loop.
 */
export async function dispatchMentionedProjectAgent(
  tx: TransactionSql,
  args: {
    auth: ProjectAuthContext;
    task: TaskRow;
    project: ProjectRow;
    mentions: { type: string; id: string }[];
    authorType: string;
    authorId: string;
    text: string;
    source: MentionSource;
  },
): Promise<void> {
  if (args.authorType !== 'user') return;
  const mentionedAgentIds = new Set(
    args.mentions
      .filter((mention) => mention.type === 'agent')
      .map((mention) => mention.id),
  );
  if (mentionedAgentIds.size === 0) return;
  if (args.task.archivedAt !== null) return;
  const mayWork = await mayWorkTask(tx, args.project, args.task, args.auth);

  const runs = await tx<
    {
      id: string;
      agentId: string;
      status: string;
      execId: string;
      sessionId: string;
      harness: string;
      model: string;
      modelProvider: string | null;
      deadlineAt: number;
      startedBy: string;
    }[]
  >`
    SELECT id, agent_id AS "agentId", status, exec_id AS "execId",
           session_id AS "sessionId", harness, model,
           model_provider AS "modelProvider",
           deadline_at_ms::float8 AS "deadlineAt",
           started_by AS "startedBy"
    FROM app.project_agent_runs
    WHERE task_id = ${args.task.id} AND org_id = ${args.auth.organizationId}
      AND status IN ('queued', 'running')
    LIMIT 1
  `;
  const run = runs[0];
  if (run !== undefined) {
    // A queued run needs nothing (its start reads the brief after this
    // write commits); a live run of an UNMENTIONED instance is never
    // preempted or reassigned over.
    if (run.status !== 'running' || !mentionedAgentIds.has(run.agentId)) {
      return;
    }
    // Steering is the work gate's, and the run's own starter's.
    if (!mayWork && run.startedBy !== args.auth.userId) {
      console.warn(
        `[tasks] agent mention on ${args.task.id} stays a plain mention (the author may not work this task)`,
      );
      return;
    }
    const agents = await tx<
      {
        instructions: string | null;
        skills: string[];
        connectors: string[];
        tools: string[];
        secrets: string[];
      }[]
    >`
      SELECT instructions, skills, connectors, tools, secrets
      FROM app.project_agents WHERE id = ${run.agentId} LIMIT 1
    `;
    const agent = agents[0];
    if (agent === undefined) return;

    const authors = await tx<{ name: string | null; email: string | null }[]>`
      SELECT "name", "email" FROM "user" WHERE "id" = ${args.authorId} LIMIT 1
    `;
    const author =
      (authors[0]?.name ?? '').trim() ||
      (authors[0]?.email ?? '').trim() ||
      'a teammate';

    await addJobInTx(tx, 'task.agent_steer', {
      organizationId: args.auth.organizationId,
      runId: run.id,
      taskId: args.task.id,
      agentId: run.agentId,
      execId: run.execId,
      sessionId: run.sessionId,
      harness: run.harness,
      deadlineAt: run.deadlineAt,
      model: run.model,
      ...(run.modelProvider !== null
        ? { modelProvider: run.modelProvider }
        : {}),
      ...(agent.instructions !== null
        ? { instructions: agent.instructions }
        : {}),
      skills: agent.skills,
      connectors: agent.connectors,
      tools: agent.tools,
      secrets: agent.secrets,
      feedback: args.text,
      mentionSource: args.source,
      author,
      authorId: args.authorId,
      ...(args.auth.apiKeyId !== undefined
        ? { authorApiKeyId: args.auth.apiKeyId }
        : {}),
      attempt: 0,
    });
    return;
  }

  if (!mayWork) {
    console.warn(
      `[tasks] agent mention on ${args.task.id} stays a plain mention (the author may not work this task)`,
    );
    return;
  }

  // Idle lane: resolve the FIRST mentioned id that is an instance OF THIS
  // project (mention order is appearance order — the 0.4 rule).
  let instance:
    | {
        id: string;
        harness: string;
        model: string;
        modelProvider: string | null;
      }
    | undefined;
  for (const mention of args.mentions) {
    if (mention.type !== 'agent') continue;
    const candidates = await tx<
      {
        id: string;
        harness: string;
        model: string;
        modelProvider: string | null;
      }[]
    >`
      SELECT id, harness, model, model_provider AS "modelProvider"
      FROM app.project_agents
      WHERE id = ${mention.id} AND project_id = ${args.task.projectId}
        AND org_id = ${args.auth.organizationId}
      LIMIT 1
    `;
    if (candidates[0] !== undefined) {
      instance = candidates[0];
      break;
    }
  }
  if (instance === undefined) return;
  if (!(await mentionAutomationEnabled(tx, args.auth.organizationId))) return;
  // An automation-driven task keeps its automation — one engine per task.
  if (await taskHasLiveAutomationRun(tx, args.task)) return;
  if (instance.model === '') {
    console.warn(
      `[tasks] mention kick for agent ${instance.id} refused: agent_model_missing`,
    );
    return;
  }
  const agent = instance;
  try {
    // A savepoint, so a start the organization's standard agent refuses for
    // this author (switched off, or no model they may use) takes the
    // reassignment with it: the text stays a plain mention, as with the
    // lane's other refusals, and the comment or task still saves.
    await tx.savepoint(async (sp) => {
      if (
        args.task.assigneeType !== 'agent' ||
        args.task.assigneeId !== agent.id
      ) {
        // (Re)assign exactly like the picker — activity, audit, notify.
        await assignTask(sp, args.auth, {
          taskId: args.task.id,
          assigneeType: 'agent',
          assigneeId: agent.id,
        });
      }
      const kicked = await kickAgentRun(sp, {
        organizationId: args.auth.organizationId,
        projectId: args.task.projectId,
        taskId: args.task.id,
        agentId: agent.id,
        harness: agent.harness,
        model: agent.model,
        ...(agent.modelProvider !== null
          ? { modelProvider: agent.modelProvider }
          : {}),
        startedBy: args.auth.userId,
        ...(args.auth.apiKeyId !== undefined
          ? { apiKeyId: args.auth.apiKeyId }
          : {}),
        trigger: 'mention',
        mentionSource: args.source,
        ...(args.source === 'comment' ? { feedback: args.text } : {}),
      });
      if (kicked.reused) {
        // A racing kick landed between this transaction's live-run probe
        // and here — the text rides the standing run instead.
        console.warn(
          `[tasks] mention kick for agent ${agent.id} reused the standing run`,
        );
        return;
      }
      await handTaskToInProgressForKick(sp, {
        organizationId: args.auth.organizationId,
        taskId: args.task.id,
        userId: args.auth.userId,
      });
    });
  } catch (error) {
    if (!isStandardAgentRefusal(error)) throw error;
    console.warn(
      `[tasks] agent mention on ${args.task.id} stays a plain mention (${error.code})`,
    );
  }
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
  await assertTaskWorkable(tx, project, task, auth);
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
    ...(auth.apiKeyId !== undefined ? { apiKeyId: auth.apiKeyId } : {}),
    trigger: 'manual',
  });
  if (kicked.reused) {
    return { started: false, reason: 'already_running' };
  }
  return { started: true };
}

/** Why a deferred agent kick may no longer start work. */
export type DeferredAgentKickRefusal =
  | 'project_unavailable'
  | 'project_archived'
  | 'not_permitted';

/**
 * The admission a DEFERRED agent kick passes before it creates a run: the
 * auto-retry job continuing a failed run's kick, and the steer that missed
 * its run and starts a fresh one. Both act long after the person asked, so
 * they answer to the manual Start's gate ({@link assertTaskWorkable}) as it
 * stands NOW, for the person whose kick they continue: the project still
 * exists and is active, and that person may still work the task — an
 * editor of the project, or a member whose own task it is. A start a
 * schedule began names no person: it continues only while that schedule
 * may still act in the project (`scheduleMayActInProject` — enabled, and its
 * automation still bound there).
 *
 * Archiving, a sharing change and a delete all update the project row, so
 * it stays share-locked until the caller's transaction commits: they order
 * around the admission, and none lands between this check and the run.
 * `null` admits. A refusal is final, so callers skip rather than throw — a
 * retried job would only meet it again.
 */
export async function deferredAgentKickRefusal(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    task: WorkableTask;
    startedBy: string;
  },
): Promise<DeferredAgentKickRefusal | null> {
  const locked = await tx<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
    FOR SHARE
  `;
  if (locked.length === 0) return 'project_unavailable';
  const project = await loadProjectOrThrow(tx, args.projectId);
  if (project.archivedAt !== null) return 'project_archived';
  const starter = parseRunStarter(args.startedBy);
  if (starter.kind === 'trigger') {
    return (await scheduleMayActInProject(tx, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      triggerId: starter.triggerId,
    }))
      ? null
      : 'not_permitted';
  }
  if (starter.kind === 'unknown') return 'not_permitted';
  const member = await findActingMember(
    tx,
    args.organizationId,
    starter.userId,
  );
  if (member === null) return 'not_permitted';
  const auth = await getProjectAuthContext(tx, {
    organizationId: args.organizationId,
    userId: starter.userId,
    role: member.role,
  });
  return (await mayWorkTask(tx, project, args.task, auth))
    ? null
    : 'not_permitted';
}

// ---------------------------------------------------------------------------
// Ops indicators (the board's working pulse / needs-answer / review chips)
// ---------------------------------------------------------------------------

const TASK_OPS_INDICATOR_CAP = 50;
const TASK_OPS_RUN_SCAN_CAP = 100;

/** One live agent run, as the board shows it beside its card. */
export interface TaskOpsRun {
  taskId: string;
  runId: string;
  agentId: string;
  status: 'queued' | 'running';
  /** It waits for room: a worker, the host, a Destroy, or its sandbox. */
  waiting: boolean;
  /** Why it waits, while it waits and a reason was kept. */
  waitingReason?: AgentRunWaitingReason;
  /** When it was asked for. */
  startedAt: number;
  /** When it began work in its sandbox. */
  launchedAt?: number;
  /** The worker it works in, once it took one: its number among the
   * agent's workers (or the member's, for a run a member started). */
  worker?: number;
}

export interface TaskOpsIndicators {
  runningTaskIds: string[];
  askingTaskIds: string[];
  pendingReviews: {
    taskId: string;
    approvalId: string;
    requestedFor?: string;
    reviewer: TaskReviewRecipient | null;
  }[];
  /** Live agent runs, running first, then waiting and queued ones oldest
   * first; at most {@link TASK_OPS_INDICATOR_CAP}. */
  runs: TaskOpsRun[];
  /** More live runs exist than `runs` lists. A card whose task is missing
   * from a truncated list may still have a run, waiting or working: read it
   * as unknown, never as idle, and count the list as "50+". */
  runsTruncated: boolean;
}

/** The live agent runs of the given projects (`TaskOpsIndicators.runs`):
 * one bounded read, the cap plus one row to tell a truncated list. */
async function readLiveAgentRuns(
  sql: Sql,
  organizationId: string,
  projectIds: readonly string[],
): Promise<Pick<TaskOpsIndicators, 'runs' | 'runsTruncated'>> {
  const rows = await sql<
    {
      runId: string;
      taskId: string;
      agentId: string;
      status: 'queued' | 'running';
      sessionId: string;
      sessionClaimedAt: number | null;
      waitingForCapacityAt: number | null;
      waiting: boolean;
      waitingReason: string | null;
      startedAt: number;
      launchedAt: number | null;
    }[]
  >`
    SELECT id AS "runId", task_id AS "taskId", agent_id AS "agentId", status,
           session_id AS "sessionId",
           session_claimed_at_ms::float8 AS "sessionClaimedAt",
           waiting_for_capacity_at_ms::float8 AS "waitingForCapacityAt",
           ${sql.unsafe(parkedRunSql())} AS waiting,
           ${sql.unsafe(parkedWaitingReasonSql())} AS "waitingReason",
           started_at_ms::float8 AS "startedAt",
           launched_at_ms::float8 AS "launchedAt"
    FROM app.project_agent_runs
    WHERE org_id = ${organizationId} AND project_id = ANY(${projectIds})
      AND status IN ('queued', 'running')
    ORDER BY (status = 'running') DESC, started_at_ms, seq
    LIMIT ${TASK_OPS_INDICATOR_CAP + 1}
  `;
  const runs = rows.slice(0, TASK_OPS_INDICATOR_CAP).map((row): TaskOpsRun => {
    const worker = agentRunWorkerNumber(row);
    const run: TaskOpsRun = {
      taskId: row.taskId,
      runId: row.runId,
      agentId: row.agentId,
      status: row.status,
      waiting: row.waiting,
      startedAt: row.startedAt,
    };
    if (row.waiting && isAgentRunWaitingReason(row.waitingReason)) {
      run.waitingReason = row.waitingReason;
    }
    if (row.launchedAt !== null) run.launchedAt = row.launchedAt;
    if (worker !== undefined) run.worker = worker;
    return run;
  });
  return { runs, runsTruncated: rows.length > TASK_OPS_INDICATOR_CAP };
}

function projectPendingReviews(
  rows: readonly {
    taskId: string;
    approvalId: string;
    requestedFor: string | null;
    reviewer: TaskReviewRecipient | null;
  }[],
): TaskOpsIndicators['pendingReviews'] {
  return rows.map((row) => ({
    taskId: row.taskId,
    approvalId: row.approvalId,
    reviewer: row.reviewer,
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
    JOIN app.tasks t ON t.id = r.input -> 'task' ->> 'id'
      AND t.org_id = r.org_id AND t.project_id = ${projectId}
    WHERE r.org_id = ${auth.organizationId}
      AND (r.project_id = ${projectId} OR r.project_id IS NULL)
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
    ...(await readLiveAgentRuns(sql, auth.organizationId, [projectId])),
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
  const projects = await listProjects(sql, auth, { summary: true });
  if (projects.length === 0) {
    return {
      runningTaskIds: [],
      askingTaskIds: [],
      pendingReviews: [],
      runs: [],
      runsTruncated: false,
    };
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
    ...(await readLiveAgentRuns(sql, auth.organizationId, projectIds)),
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
