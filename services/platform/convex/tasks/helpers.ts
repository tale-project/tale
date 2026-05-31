/**
 * Shared write-side helpers for the tasks feature, used by both the
 * user-facing `mutations.ts` and the agent-facing `internal_mutations.ts`.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { initialRank, rankBetween } from './rank';

export const TERMINAL_STATUSES = new Set(['done', 'cancelled']);

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_COMMENT_MAX = 10_000;
export const TASK_LABELS_MAX = 50;
export const TASK_LABEL_CHARS_MAX = 50;

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
    createdAt: Date.now(),
  });
}
