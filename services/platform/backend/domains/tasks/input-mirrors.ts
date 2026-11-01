import type { Sql } from 'postgres';

/**
 * Which copies of task inputs a project agent's worker may drop. Every run
 * stages its task's attachments and deliverables into its worker
 * (`/agent/inputs/<taskId>`), and a review stages the files it reads under
 * the reviewed task (`/agent/inputs/reviews/<sha256 of the task id>`). A
 * worker serves task after task, so without a deleter it keeps a copy for
 * every task it ever worked. A run's start asks which of the copies its
 * worker holds are no longer needed (`core/tasks/task_input_mirrors.ts`);
 * the next run of such a task stages its inputs again, as every run does.
 *
 * The same pass drops a task's own directory in the worker's workspace
 * (`/agent/workspace/tasks/<taskId>`), where a run keeps the task's clones,
 * checkouts and scratch: a worker busy on task after task is never idle long
 * enough for the workspace cleanup, so without this it keeps every checkout
 * its runs ever made.
 */

/** How long a copy of an open task's inputs stays in a worker after the task
 * or a run of it last changed. */
export const TASK_INPUT_MIRROR_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** What decides whether a worker may drop its copy of a task's inputs. */
export interface TaskInputMirrorFacts {
  status: string;
  archived: boolean;
  /** When the task, or a run of it, last changed, epoch ms. */
  touchedAt: number;
  /** A run of the task is queued, waiting or working, in any worker. */
  live: boolean;
}

/**
 * Whether a worker may drop its copy of a task's inputs: never while a run
 * of the task is live; otherwise once the task is done, cancelled or
 * archived, or has not changed for {@link TASK_INPUT_MIRROR_RETENTION_MS}.
 * A task that no longer exists (`undefined`) needs no copy.
 */
export function isTaskInputMirrorStale(
  task: TaskInputMirrorFacts | undefined,
  now: number,
): boolean {
  return isStaleAfter(task, now, TASK_INPUT_MIRROR_RETENTION_MS);
}

function isStaleAfter(
  task: TaskInputMirrorFacts | undefined,
  now: number,
  retentionMs: number,
): boolean {
  if (task === undefined) return true;
  if (task.live) return false;
  return (
    task.status === 'done' ||
    task.status === 'cancelled' ||
    task.archived ||
    now - task.touchedAt >= retentionMs
  );
}

/** How long an open task's directory stays in a worker after the task or a
 * run of it last changed: shorter than an input copy's, since a checkout
 * holds gigabytes. */
export const TASK_DIRECTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a worker may drop a task's directory: never while a run of the
 * task is live; otherwise once the task is done, cancelled or archived, or
 * has not changed for {@link TASK_DIRECTORY_RETENTION_MS}. A task that no
 * longer exists (`undefined`) needs none.
 */
export function isTaskDirectoryStale(
  task: TaskInputMirrorFacts | undefined,
  now: number,
): boolean {
  return isStaleAfter(task, now, TASK_DIRECTORY_RETENTION_MS);
}

interface MirrorRow extends TaskInputMirrorFacts {
  key: string;
}

/** The columns {@link isTaskInputMirrorStale} reads, for `app.tasks t`. */
const MIRROR_FACT_COLUMNS = `t.status,
  t.archived_at_ms IS NOT NULL AS archived,
  GREATEST(t.updated_at_ms, COALESCE(t.last_agent_run_at_ms, 0))::float8
    AS "touchedAt",
  EXISTS (
    SELECT 1 FROM app.project_agent_runs r
    WHERE r.org_id = t.org_id AND r.task_id = t.id
      AND r.status IN ('queued', 'running')
  ) AS live`;

/**
 * Of the copies a worker of `agentId` holds, the ones it may drop: task
 * copies by task id, review copies by the sha256 (hex) of the reviewed
 * task's id, task directories by task id. A name that matches no task of the organization (a deleted
 * task) is dropped; a review of a task outside the agent's project cannot
 * be told from one, and is dropped too, since its next review stages its
 * files again. Read-only, scoped to the organization.
 */
export async function staleTaskInputMirrors(
  sql: Sql,
  args: {
    organizationId: string;
    agentId: string;
    taskIds: readonly string[];
    reviewHashes: readonly string[];
    taskDirIds?: readonly string[];
    now?: number;
  },
): Promise<{
  taskIds: string[];
  reviewHashes: string[];
  taskDirIds: string[];
}> {
  const now = args.now ?? Date.now();
  const taskDirIds = args.taskDirIds ?? [];
  const ids = [...new Set([...args.taskIds, ...taskDirIds])];
  const taskRows =
    ids.length === 0
      ? []
      : await sql<MirrorRow[]>`
          SELECT t.id AS key, ${sql.unsafe(MIRROR_FACT_COLUMNS)}
          FROM app.tasks t
          WHERE t.org_id = ${args.organizationId}
            AND t.id = ANY(${ids})
        `;
  // A review copy is named by its task's hash, computed here as the staging
  // computes it (`reviewInputsDir`): over the agent's own project, the only
  // one its reviews can reach.
  const reviewRows =
    args.reviewHashes.length === 0
      ? []
      : await sql<MirrorRow[]>`
          SELECT encode(sha256(convert_to(t.id, 'UTF8')), 'hex') AS key,
                 ${sql.unsafe(MIRROR_FACT_COLUMNS)}
          FROM app.tasks t
          WHERE t.org_id = ${args.organizationId}
            AND t.project_id IN (
              SELECT a.project_id FROM app.project_agents a
              WHERE a.id = ${args.agentId} AND a.org_id = ${args.organizationId}
            )
            AND encode(sha256(convert_to(t.id, 'UTF8')), 'hex')
              = ANY(${[...args.reviewHashes]})
        `;
  const stale = (
    keys: readonly string[],
    rows: readonly MirrorRow[],
    isStale: (task: TaskInputMirrorFacts | undefined, now: number) => boolean,
  ) => {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return keys.filter((key) => isStale(byKey.get(key), now));
  };
  return {
    taskIds: stale(args.taskIds, taskRows, isTaskInputMirrorStale),
    reviewHashes: stale(args.reviewHashes, reviewRows, isTaskInputMirrorStale),
    taskDirIds: stale(taskDirIds, taskRows, isTaskDirectoryStale),
  };
}
