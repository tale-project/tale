import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
} from '@tale/shared/db/serializable';
import type { TransactionSql } from 'postgres';

/**
 * The project's work key: the transaction-level lock every writer of the
 * project's shared rows takes before them — the project row (its task
 * number counter, its open and done counts) and the project's wake row
 * (`app.project_wakes`). One key for both keeps the order every such writer
 * already takes them in: a task row, then the key, then the project row or
 * the wake row. A conflict on one of those rows is marked with the key
 * (`queueOnProjectWork`), so the retry takes it as a session lock before its
 * own snapshot and lines up behind the writer it lost to instead of
 * colliding again. Writers of different projects never wait on each other.
 */
export function projectWorkQueueKey(projectId: string): string {
  return `project-work:${projectId}`;
}

/** Take the project's work key; re-entrant inside one transaction. */
export async function lockProjectWork(
  tx: TransactionSql,
  projectId: string,
): Promise<void> {
  const key = projectWorkQueueKey(projectId);
  try {
    await tx`
      SELECT pg_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${key}))
    `;
  } catch (error) {
    throw markRetryQueueKey(error, key);
  }
}

/**
 * {@link lockProjectWork} without waiting: `true` when this transaction now
 * holds the key (or already did), `false` while another does — for a sweep
 * that must not stall behind one busy project.
 */
export async function tryLockProjectWork(
  tx: TransactionSql,
  projectId: string,
): Promise<boolean> {
  const rows = await tx<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(
      ${RETRY_QUEUE_LOCK_CLASS}, hashtext(${projectWorkQueueKey(projectId)})
    ) AS locked
  `;
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- only an explicit database true admits a sweep
  return rows[0]?.locked === true;
}

/** Mark a conflict met under the project's work key with that key. */
export function queueOnProjectWork(error: unknown, projectId: string): unknown {
  return markRetryQueueKey(error, projectWorkQueueKey(projectId));
}
