/**
 * Shared write-side helpers for the tasks feature, used by both the
 * user-facing `mutations.ts` and the agent-facing `internal_mutations.ts`.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import {
  defaultTaskLabelColor,
  PREDEFINED_TASK_LABELS,
} from '../../lib/shared/task-label-colors';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { parseIssueNumber, parseRepoRef } from './issue_ref';
import { initialRank, rankBetween } from './rank';

export const TERMINAL_STATUSES = new Set(['done', 'cancelled']);

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_COMMENT_MAX = 10_000;
export const TASK_LABELS_MAX = 50;
export const TASK_LABEL_CHARS_MAX = 50;

/**
 * Normalize and dedupe raw label names. Returns `undefined` when the input is
 * nullish or empty after trimming — matching the historical "omit field"
 * posture. Throws `TASK_LABELS_INVALID` on oversize lists/names.
 */
export function normalizeLabelNames(
  labels: string[] | undefined,
): string[] | undefined {
  if (labels == null) return undefined;
  if (labels.length > TASK_LABELS_MAX) {
    throw new AppError({ code: 'TASK_LABELS_INVALID' });
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = raw.trim().toLowerCase();
    if (label.length === 0 || label.length > TASK_LABEL_CHARS_MAX) {
      throw new AppError({ code: 'TASK_LABELS_INVALID' });
    }
    if (!seen.has(label)) {
      seen.add(label);
      normalized.push(label);
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve label names to project-scoped catalog ids.
 *
 * When `createIfMissing` is true (agent/automation paths), unknown names are
 * upserted. When false (human task attach), unknown names throw
 * `TASK_LABEL_UNKNOWN` — create labels via `createTaskLabel` / the manage
 * dialog instead. Empty / undefined input clears the task's labels.
 */
export async function resolveProjectLabels(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    projectId: Id<'projects'>;
    names: string[] | undefined;
    createdBy: string;
    createIfMissing?: boolean;
  },
): Promise<Id<'taskLabels'>[] | undefined> {
  const names = normalizeLabelNames(args.names);
  if (names === undefined) return undefined;

  const createIfMissing = args.createIfMissing === true;
  const now = Date.now();
  const ids: Id<'taskLabels'>[] = [];
  for (const name of names) {
    const existing = await ctx.db
      .query('taskLabels')
      .withIndex('by_project_name', (q) =>
        q.eq('projectId', args.projectId).eq('name', name),
      )
      .unique();
    if (existing) {
      ids.push(existing._id);
      continue;
    }
    if (!createIfMissing) {
      throw new AppError({
        code: 'TASK_LABEL_UNKNOWN',
        data: { name },
      });
    }
    const id = await ctx.db.insert('taskLabels', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      name,
      color: defaultTaskLabelColor(name),
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    ids.push(id);
  }
  return ids;
}

/**
 * Idempotently seed the built-in project labels (bug / feature / improvement)
 * with their default colours. Called on project create and from the manage
 * surface so existing projects pick them up without a separate admin step.
 */
export async function ensureDefaultProjectLabels(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    projectId: Id<'projects'>;
    createdBy: string;
  },
): Promise<void> {
  const now = Date.now();
  for (const preset of PREDEFINED_TASK_LABELS) {
    const existing = await ctx.db
      .query('taskLabels')
      .withIndex('by_project_name', (q) =>
        q.eq('projectId', args.projectId).eq('name', preset.name),
      )
      .unique();
    if (existing) continue;
    await ctx.db.insert('taskLabels', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      name: preset.name,
      color: preset.color,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/** Load catalog rows for a task's `labelIds`, preserving attachment order. */
export async function loadTaskLabelDocs(
  ctx: QueryCtx | MutationCtx,
  labelIds: Id<'taskLabels'>[] | undefined,
): Promise<Doc<'taskLabels'>[]> {
  if (!labelIds || labelIds.length === 0) return [];
  const docs: Doc<'taskLabels'>[] = [];
  for (const id of labelIds) {
    const doc = await ctx.db.get(id);
    if (doc) docs.push(doc);
  }
  return docs;
}

/** Resolved label DTO used on task read paths. Colour is always derived from
 *  the name — never a stored override. */
export function taskLabelDto(doc: Doc<'taskLabels'>): {
  id: Id<'taskLabels'>;
  name: string;
  color: string;
} {
  return {
    id: doc._id,
    name: doc.name,
    color: defaultTaskLabelColor(doc.name),
  };
}

/**
 * True when the schedule pair is unset or ordered (start ≤ due). Both dates
 * are ms-epoch at local midnight; either may be absent.
 */
export function isScheduleOrderValid(
  startDate: number | undefined,
  dueDate: number | undefined,
): boolean {
  if (startDate === undefined || dueDate === undefined) return true;
  return startDate <= dueDate;
}

/**
 * Coerce an externally-sourced task title (e.g. a GitHub issue title) to fit
 * `TASK_TITLE_MAX`. Unlike the human/agent create paths — which *reject* an
 * over-long title so the author can shorten it — an imported title is not under
 * anyone's control at the import site (GitHub allows longer titles than our
 * board), so truncating with an ellipsis keeps the import working instead of
 * failing the whole task. The full title stays reachable via `externalUrl`.
 * Returns an empty string only when the input is blank; callers supply a
 * fallback for that (GitHub issues always carry a title, so it's defensive).
 */
export function truncateImportedTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= TASK_TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Claim the next per-project task number by incrementing the project's
 * `taskCounter` in the same transaction as the insert. Monotonic and
 * gap-tolerant — numbers are never recycled, so identifiers stay stable even
 * after a task is deleted.
 */
export async function nextTaskNumber(
  ctx: MutationCtx,
  project: Doc<'projects'>,
): Promise<number> {
  const number = (project.taskCounter ?? 0) + 1;
  await ctx.db.patch(project._id, { taskCounter: number });
  return number;
}

/**
 * Which denormalized project counter a task state belongs to. See the bucket
 * semantics documented on `projectsTable` — `archivedAt` beats every status,
 * and `cancelled` is counted nowhere so abandoned work never inflates the
 * progress denominator.
 */
export type TaskCountBucket = 'open' | 'done' | 'none';

export function taskCountBucket(
  state: Pick<Doc<'tasks'>, 'status' | 'archivedAt'>,
): TaskCountBucket {
  if (state.archivedAt !== undefined) return 'none';
  if (state.status === 'done') return 'done';
  if (state.status === 'cancelled') return 'none';
  return 'open';
}

/**
 * The ONE writer of `projects.openTaskCount` / `doneTaskCount`.
 *
 * Modelled as a bucket TRANSITION rather than per-event helpers on purpose:
 * `bulkUpdateTasks` writes `status` AND `archivedAt` in a single patch, so a
 * pair of countStatusChanged/countArchived helpers would double-count that
 * row. One transition over both dimensions cannot.
 */
async function applyTaskCountTransition(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  before: TaskCountBucket,
  after: TaskCountBucket,
): Promise<void> {
  // Makes same-status reorders and every within-bucket move (backlog→todo,
  // todo→in_progress) free — no project write at all.
  if (before === after) return;

  // Fresh read on EVERY call, never a doc cached across a loop: Convex
  // mutations read-your-own-writes, so a per-iteration re-read sees the
  // previous iteration's delta. Caching would silently keep only the last.
  const project = await ctx.db.get(projectId);
  // `deleteProject` orphans tasks rather than cascading, so a task can outlive
  // its project — nothing to count then.
  if (!project) return;

  const patch: {
    openTaskCount?: number;
    doneTaskCount?: number;
  } = {};

  // `Math.max(0, …)` on every decrement mirrors the `commentCount` delete
  // idiom: drift then self-heals downward instead of going negative.
  if (before === 'open') {
    patch.openTaskCount = Math.max(0, (project.openTaskCount ?? 0) - 1);
  } else if (before === 'done') {
    patch.doneTaskCount = Math.max(0, (project.doneTaskCount ?? 0) - 1);
  }

  if (after === 'open') {
    patch.openTaskCount =
      (patch.openTaskCount ?? project.openTaskCount ?? 0) + 1;
  } else if (after === 'done') {
    patch.doneTaskCount =
      (patch.doneTaskCount ?? project.doneTaskCount ?? 0) + 1;
  }

  await ctx.db.patch(projectId, patch);
}

/** Count a freshly inserted task. Reads the bucket from the INSERTED state —
 *  external-issue sync can create a task directly as `done`. */
export async function countTaskCreated(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  state: Pick<Doc<'tasks'>, 'status' | 'archivedAt'>,
): Promise<void> {
  await applyTaskCountTransition(
    ctx,
    projectId,
    'none',
    taskCountBucket(state),
  );
}

/** Discount a task about to be deleted. Call BEFORE `ctx.db.delete`. */
export async function countTaskDeleted(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  state: Pick<Doc<'tasks'>, 'status' | 'archivedAt'>,
): Promise<void> {
  await applyTaskCountTransition(
    ctx,
    projectId,
    taskCountBucket(state),
    'none',
  );
}

/** Move a task between buckets. Safe to call unconditionally — a within-bucket
 *  move is a no-op, so callers never need to pre-check whether status changed. */
export async function countTaskStateChanged(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  before: Pick<Doc<'tasks'>, 'status' | 'archivedAt'>,
  after: Pick<Doc<'tasks'>, 'status' | 'archivedAt'>,
): Promise<void> {
  await applyTaskCountTransition(
    ctx,
    projectId,
    taskCountBucket(before),
    taskCountBucket(after),
  );
}

/** Compute a rank that appends a task to the end of its (project,status) column. */
export async function computeEndRank(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  status: Doc<'tasks'>['status'],
): Promise<string> {
  const last = await ctx.db
    .query('tasks')
    .withIndex('by_project_status_rank', (q) =>
      q.eq('projectId', projectId).eq('status', status),
    )
    .order('desc')
    .first();
  return last ? rankBetween(last.rank, undefined) : initialRank();
}

/** True iff the task has at least one non-terminal, non-archived child. */
export async function hasOpenChildren(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
): Promise<boolean> {
  for await (const child of ctx.db
    .query('tasks')
    .withIndex('by_parent', (q) => q.eq('parentTaskId', taskId))) {
    if (!child.archivedAt && !TERMINAL_STATUSES.has(child.status)) {
      return true;
    }
  }
  return false;
}

/** The task fields a workflow-run subject is built from. */
export type TaskWorkflowSubjectFields = Pick<
  Doc<'tasks'>,
  | '_id'
  | 'title'
  | 'status'
  | 'projectId'
  | 'externalSystem'
  | 'externalId'
  | 'externalUrl'
>;

/**
 * The `input.task` subject a task-workflow run receives — ONE builder for
 * every start door (task-board Start, create→run schedule, REST, the comment
 * `@automation` trigger), so the shape the workflow templates read
 * (`input.task.*`) cannot drift between them. The issue number and
 * `owner/repo` ref are derived from the task's `externalId`
 * ("owner/repo#N"); both are null-elided for non-issue tasks.
 */
export function taskWorkflowSubjectInput(task: TaskWorkflowSubjectFields): {
  task: Record<string, unknown>;
} {
  const issueNumber = parseIssueNumber(task.externalId);
  const repoRef = parseRepoRef(task.externalId);
  return {
    task: {
      id: String(task._id),
      title: task.title,
      status: task.status,
      projectId: String(task.projectId),
      ...(task.externalSystem !== undefined
        ? { externalSystem: task.externalSystem }
        : {}),
      ...(task.externalId !== undefined ? { externalId: task.externalId } : {}),
      ...(task.externalUrl !== undefined
        ? { externalUrl: task.externalUrl }
        : {}),
      ...(issueNumber !== null ? { issueNumber } : {}),
      ...(repoRef !== null ? { repo: `${repoRef.owner}/${repoRef.repo}` } : {}),
    },
  };
}

export type TaskActivityAttribution = {
  workflowSlug?: string;
  wfExecutionId?: Id<'wfExecutions'>;
};

/** Build stored context for workflow-sentinel activity rows. */
export function workflowActivityContext(
  actorId: string,
  attribution?: TaskActivityAttribution,
): TaskActivityAttribution | undefined {
  if (actorId !== 'workflow' || !attribution) return undefined;
  const { workflowSlug, wfExecutionId } = attribution;
  if (!workflowSlug && !wfExecutionId) return undefined;
  return { workflowSlug, wfExecutionId };
}

/** Append a row to the per-task product activity timeline. */
export async function recordActivity(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    actorType: 'user' | 'agent';
    actorId: string;
    action: string;
    fromValue?: string;
    toValue?: string;
    context?: TaskActivityAttribution;
  },
): Promise<void> {
  await ctx.db.insert('taskActivity', {
    organizationId: args.task.organizationId,
    taskId: args.task._id,
    projectId: args.task.projectId,
    actorType: args.actorType,
    actorId: args.actorId,
    action: args.action,
    fromValue: args.fromValue,
    toValue: args.toValue,
    context: args.context,
    createdAt: Date.now(),
  });
}

/**
 * Activity action strings recorded by the task-ops automation pack so the
 * metrics rollups can tell HUMAN review outcomes apart from agent
 * self-moves (workflow-driven status changes log actorType 'agent', which
 * would otherwise conflate the two).
 */
export const TASK_METRIC_ACTIONS = {
  reviewPassed: 'review.passed',
  reviewChangesRequested: 'review.changes_requested',
  agentEscalated: 'agent.escalated',
  circuitBreakerTripped: 'agent.circuit_breaker_tripped',
} as const;
