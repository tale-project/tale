import type { TransactionSql } from 'postgres';

import { queueRefRelease } from '../knowledge/release-queue.ts';

/**
 * The end of a native run's transcript: the part of a run's record that a
 * task's deletion, the retention window of agent runs and a person's erasure
 * each take, and that no list of conversations reaches (the thread is bare).
 * Kept apart from the rest of the native run's code so each of those doors
 * can take it without importing the engine.
 */

/** The `app.threads.kind` of a run's transcript thread. Such a thread has no
 * `thread_metadata` row, so no chat list ever shows it: it is read through
 * the task, by the people who can read the task. */
export const TASK_RUN_THREAD_KIND = 'task_run';

/**
 * End the transcripts of runs whose record is going: the threads (their
 * messages and generation rows with them) and the files only those threads
 * held — what a run wrote and made along the way, never a deliverable, which
 * already belongs to its task. The rows are trashed here and the refs
 * returned, so the caller releases the bytes once nothing else holds them
 * (`queueRefRelease`, or the task release seam a task's deletion walks).
 */
export async function endRunTranscripts(
  tx: TransactionSql,
  args: { organizationId: string; threadIds: readonly string[] },
): Promise<string[]> {
  if (args.threadIds.length === 0) return [];
  const refs = (
    await tx<{ ref: string }[]>`
      UPDATE app.file_metadata SET
        lifecycle_status = 'trashed', status_changed_at_ms = ${Date.now()}
      WHERE org_id = ${args.organizationId}
        AND thread_id = ANY(${[...args.threadIds]})
        AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
      RETURNING storage_ref AS ref
    `
  ).map((row) => row.ref);
  await tx`
    DELETE FROM app.threads
    WHERE org_id = ${args.organizationId} AND id = ANY(${[...args.threadIds]})
  `;
  return refs;
}

/**
 * {@link endRunTranscripts} for a run record that goes while its task stays —
 * the retention window of agent runs, and a person's erasure: the bytes of
 * the files the transcripts held are queued for release in the same
 * transaction, and the release itself keeps any ref another row still holds.
 */
export async function endRunTranscriptsAndRelease(
  tx: TransactionSql,
  args: { organizationId: string; threadIds: readonly string[] },
): Promise<number> {
  const refs = await endRunTranscripts(tx, args);
  await queueRefRelease(tx, args.organizationId, refs);
  return args.threadIds.length;
}
