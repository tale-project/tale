import type { Sql, TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * The durable release job (`knowledge.release_refs`, run by
 * `runReleaseRefsJob` in `release.ts`) as every lane that hands it more than
 * one ref queues it: in jobs of a bounded size. The mail lanes and a task
 * retire queue theirs in their own transaction
 * (`conversations/message-corpus.ts`, `tasks/retire.ts`); the corpus
 * reconcile queues the bytes it could not delete (`release.ts`). Its own
 * module, so a lane reaches it without the release seam's imports.
 */

/** Refs per `knowledge.release_refs` job: a retention batch can purge a
 * thousand conversations at once, and one job's payload stays bounded. */
export const RELEASE_REFS_PER_JOB = 500;

/**
 * Queue the release of these refs on `tx`, at most `RELEASE_REFS_PER_JOB` to
 * a job. An enqueue that fails is thrown, so a caller's transaction rolls
 * back and queues nothing — unless the caller hands in `onChunkError`: it is
 * handed each chunk that failed with its error, and the next chunk is still
 * queued. That is for a caller outside a transaction; inside one, the failed
 * statement has aborted it.
 */
export async function queueRefRelease(
  tx: TransactionSql | Sql,
  organizationId: string,
  refs: readonly string[],
  options: {
    readonly onChunkError?: (refs: string[], error: unknown) => void;
  } = {},
): Promise<void> {
  for (let at = 0; at < refs.length; at += RELEASE_REFS_PER_JOB) {
    const chunk = refs.slice(at, at + RELEASE_REFS_PER_JOB);
    try {
      await addJobInTx(tx, 'knowledge.release_refs', {
        organizationId,
        refs: chunk,
      });
    } catch (error) {
      if (options.onChunkError === undefined) throw error;
      options.onChunkError(chunk, error);
    }
  }
}
