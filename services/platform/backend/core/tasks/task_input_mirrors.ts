'use node';

/**
 * The copies of task inputs a project agent's worker holds, and the pass a
 * run's start makes to drop the ones no task needs any more. Each run stages
 * its task's attachments and deliverables under `/agent/inputs/<taskId>`
 * again before every turn, and a review stages the files it reads under
 * `/agent/inputs/reviews/<sha256 of the reviewed task's id>`. A worker serves
 * task after task, so both would otherwise grow with every task it ever
 * worked. Which copies may go is the tasks domain's decision
 * (`domains/tasks/input-mirrors.ts`): a task that is closed, gone or
 * untouched for 30 days, and never one with a live run.
 */

import { createHash } from 'node:crypto';

import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import {
  sessionDeleteFiles,
  sessionListFiles,
  type SessionFsEntry,
} from '../node_only/sandbox/helpers/session_client';

/** Where a worker holds a read-only copy of each task's inputs. */
export const TASK_INPUTS_ROOT = '/agent/inputs';

/** The one directory under {@link TASK_INPUTS_ROOT} that is no task's own:
 * the files reviews were staged with, one directory per reviewed task. */
const REVIEWS_DIR_NAME = 'reviews';

const REVIEW_INPUTS_ROOT = `${TASK_INPUTS_ROOT}/${REVIEWS_DIR_NAME}`;

/** The most copies of each kind one pass looks at, the oldest first, so a
 * worker that gathered many is cleared over several starts rather than
 * holding up one. */
export const MAX_INPUT_MIRRORS_PER_PASS = 50;

/** A directory name a task id can be; anything else under the root is left
 * alone, since nothing the platform stages is named so. */
const TASK_DIR_NAME_RE = /^[A-Za-z0-9_-]{1,128}$/;
const REVIEW_DIR_NAME_RE = /^[0-9a-f]{64}$/;

/** How many names a log line spells out before it only counts the rest. */
const LOGGED_NAMES = 10;

/** The directory a worker holds a review's files in, per reviewed task:
 * named by the sha256 (hex) of the task id, which the tasks domain computes
 * the same way to tell whose it is. */
export function reviewInputsDir(taskId: string): string {
  const hash = createHash('sha256').update(taskId).digest('hex');
  return `${REVIEW_INPUTS_ROOT}/${hash}`;
}

/** The names of up to {@link MAX_INPUT_MIRRORS_PER_PASS} directories that
 * `accept` takes, the least recently changed first. */
function oldestDirs(
  entries: readonly SessionFsEntry[],
  accept: (name: string) => boolean,
): string[] {
  return entries
    .filter((entry) => entry.type === 'dir' && accept(entry.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .slice(0, MAX_INPUT_MIRRORS_PER_PASS)
    .map((entry) => entry.name);
}

function namesForLog(names: readonly string[]): string {
  const shown = names.slice(0, LOGGED_NAMES).join(', ');
  return names.length > LOGGED_NAMES
    ? `${shown} and ${names.length - LOGGED_NAMES} more`
    : shown;
}

/**
 * Drop the copies of task inputs the run's worker holds for tasks that no
 * longer need them, at the start of a run of the same agent. The run's own
 * task is never touched (its copy is staged afresh right after), nor is a
 * task with a live run anywhere. Bounded to
 * {@link MAX_INPUT_MIRRORS_PER_PASS} copies of each kind, logged, and
 * best-effort: a failure is logged and never holds up the start.
 */
export async function pruneStaleTaskInputMirrors(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    agentId: string;
    taskId: string;
    sessionId: string;
  },
): Promise<void> {
  try {
    const entries =
      (await sessionListFiles(args.sessionId, TASK_INPUTS_ROOT)) ?? [];
    const taskIds = oldestDirs(
      entries,
      (name) =>
        name !== REVIEWS_DIR_NAME &&
        name !== args.taskId &&
        TASK_DIR_NAME_RE.test(name),
    );
    const ownReviews = reviewInputsDir(args.taskId).slice(
      REVIEW_INPUTS_ROOT.length + 1,
    );
    const reviewHashes = entries.some(
      (entry) => entry.type === 'dir' && entry.name === REVIEWS_DIR_NAME,
    )
      ? oldestDirs(
          (await sessionListFiles(args.sessionId, REVIEW_INPUTS_ROOT)) ?? [],
          (name) => name !== ownReviews && REVIEW_DIR_NAME_RE.test(name),
        )
      : [];
    if (taskIds.length === 0 && reviewHashes.length === 0) return;

    const stale: { taskIds: string[]; reviewHashes: string[] } =
      await ctx.runQuery(internal.tasks.agent_runs.listStaleTaskInputMirrors, {
        organizationId: args.organizationId,
        agentId: args.agentId,
        taskIds,
        reviewHashes,
      });
    const paths = [
      ...stale.taskIds.map((id) => `${TASK_INPUTS_ROOT}/${id}`),
      ...stale.reviewHashes.map((hash) => `${REVIEW_INPUTS_ROOT}/${hash}`),
    ];
    if (paths.length === 0) return;
    const removed = await sessionDeleteFiles(args.sessionId, paths);
    if (removed.deleted.length > 0) {
      console.info(
        `[task-agent] removed ${removed.deleted.length} stale task input cop${removed.deleted.length === 1 ? 'y' : 'ies'} from ${args.sessionId}: ${namesForLog(removed.deleted)}`,
      );
    }
    for (const skipped of removed.skipped) {
      console.warn(
        `[task-agent] the stale task inputs ${skipped.path} in ${args.sessionId} could not be removed: ${skipped.reason}`,
      );
    }
  } catch (err) {
    console.warn(
      `[task-agent] clearing stale task inputs in ${args.sessionId} failed (continuing):`,
      err,
    );
  }
}
