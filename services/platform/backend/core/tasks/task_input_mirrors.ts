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
 *
 * The same pass removes the directories runs keep their tasks' clones,
 * checkouts and scratch in (`/agent/workspace/tasks/<taskId>`), once their
 * task is closed, gone or untouched for 7 days: a worker that works every
 * hour is never idle long enough for the workspace cleanup, and would keep
 * every checkout its runs ever made.
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

/** The most copies of each kind one pass removes, the oldest first, so a
 * worker that gathered many is cleared over several starts rather than
 * holding up one. */
export const MAX_INPUT_MIRRORS_PER_PASS = 50;

/** The most copies of each kind one pass asks about, the oldest first: far
 * more than it removes, so copies that are still needed — the oldest are
 * often long-open tasks — never hide the stale ones behind them. One
 * indexed lookup answers them all. */
const MAX_INPUT_MIRROR_CANDIDATES = 1000;

/** A directory name a task id can be; anything else under the root is left
 * alone, since nothing the platform stages is named so. */
const TASK_DIR_NAME_RE = /^[A-Za-z0-9_-]{1,128}$/;
const REVIEW_DIR_NAME_RE = /^[0-9a-f]{64}$/;

/** Where runs keep their tasks' clones, checkouts and scratch files, one
 * directory per task: inside the workspace, the harnesses' working directory,
 * which every harness's file tools reach. */
const TASK_DIRS_ROOT = '/agent/workspace/tasks';

/** How long an open task's directory stays after the task last changed, as
 * the tasks domain decides it (`TASK_DIRECTORY_RETENTION_MS`); the guidance
 * names it to the agent. */
export const TASK_DIR_RETENTION_DAYS = 7;

/** The most task directories one pass removes, the oldest first: each can
 * hold gigabytes, so a worker that gathered many is cleared over several
 * starts. */
export const MAX_TASK_DIRS_PER_PASS = 5;

/** A task id as the platform makes them (a UUID). Only a directory so named
 * under {@link TASK_DIRS_ROOT} is a task's; anything else there is the
 * agent's own, and left alone. */
const TASK_ID_DIR_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How many names a log line spells out before it only counts the rest. */
const LOGGED_NAMES = 10;

/** The directory a worker holds a review's files in, per reviewed task:
 * named by the sha256 (hex) of the task id, which the tasks domain computes
 * the same way to tell whose it is. */
export function reviewInputsDir(taskId: string): string {
  const hash = createHash('sha256').update(taskId).digest('hex');
  return `${REVIEW_INPUTS_ROOT}/${hash}`;
}

/** The names of up to {@link MAX_INPUT_MIRROR_CANDIDATES} directories that
 * `accept` takes, the least recently changed first. */
function oldestDirs(
  entries: readonly SessionFsEntry[],
  accept: (name: string) => boolean,
): string[] {
  return entries
    .filter((entry) => entry.type === 'dir' && accept(entry.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .slice(0, MAX_INPUT_MIRROR_CANDIDATES)
    .map((entry) => entry.name);
}

/** The directory a run keeps its task's clones, checkouts and scratch in. */
export function taskWorkDir(taskId: string): string {
  return `${TASK_DIRS_ROOT}/${taskId}`;
}

function namesForLog(names: readonly string[]): string {
  const shown = names.slice(0, LOGGED_NAMES).join(', ');
  return names.length > LOGGED_NAMES
    ? `${shown} and ${names.length - LOGGED_NAMES} more`
    : shown;
}

/**
 * Remove task directories one at a time, logged. A failure, a timeout
 * included, ends the pass: the worker goes on with a removal it started, and
 * the next start's pass sees what is left. Never rejects.
 */
async function removeTaskDirs(
  sessionId: string,
  dirs: readonly string[],
): Promise<void> {
  const deleted: string[] = [];
  try {
    for (const dir of dirs) {
      const removed = await sessionDeleteFiles(sessionId, [dir]);
      deleted.push(...removed.deleted);
      for (const skipped of removed.skipped) {
        console.warn(
          `[task-agent] the task directory ${skipped.path} in ${sessionId} could not be removed: ${skipped.reason}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[task-agent] removing closed tasks’ directories in ${sessionId} stopped (the next start goes on):`,
      err,
    );
  }
  if (deleted.length > 0) {
    console.info(
      `[task-agent] removed ${deleted.length} task director${deleted.length === 1 ? 'y' : 'ies'} from ${sessionId}: ${namesForLog(deleted)}`,
    );
  }
}

/**
 * Drop the copies of task inputs the run's worker holds for tasks that no
 * longer need them, at the start of a run of the same agent, and the task
 * directories ({@link TASK_DIRS_ROOT}) no task needs any more. The run's own
 * task is never touched (its copy is staged afresh right after), nor is a
 * task with a live run anywhere. Bounded to
 * {@link MAX_INPUT_MIRRORS_PER_PASS} copies of each kind and
 * {@link MAX_TASK_DIRS_PER_PASS} task directories, logged, and best-effort:
 * a failure is logged and never holds up the start. Task directories are
 * removed while the run goes on, since a checkout can take longer to delete
 * than a start may wait.
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
    const taskDirIds = oldestDirs(
      (await sessionListFiles(args.sessionId, TASK_DIRS_ROOT)) ?? [],
      (name) => name !== args.taskId && TASK_ID_DIR_NAME_RE.test(name),
    );
    if (
      taskIds.length === 0 &&
      reviewHashes.length === 0 &&
      taskDirIds.length === 0
    ) {
      return;
    }

    const stale: {
      taskIds: string[];
      reviewHashes: string[];
      taskDirIds: string[];
    } = await ctx.runQuery(
      internal.tasks.agent_runs.listStaleTaskInputMirrors,
      {
        organizationId: args.organizationId,
        agentId: args.agentId,
        taskIds,
        reviewHashes,
        taskDirIds,
      },
    );
    // The answer keeps the candidates' order, oldest first.
    const dirs = stale.taskDirIds
      .slice(0, MAX_TASK_DIRS_PER_PASS)
      .map(taskWorkDir);
    if (dirs.length > 0) void removeTaskDirs(args.sessionId, dirs);
    const paths = [
      ...stale.taskIds
        .slice(0, MAX_INPUT_MIRRORS_PER_PASS)
        .map((id) => `${TASK_INPUTS_ROOT}/${id}`),
      ...stale.reviewHashes
        .slice(0, MAX_INPUT_MIRRORS_PER_PASS)
        .map((hash) => `${REVIEW_INPUTS_ROOT}/${hash}`),
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
