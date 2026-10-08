import type { Sql } from 'postgres';

import { RAG_ERROR_USAGE_LIMIT } from '../../core/knowledge/rag_error_codes.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  HELD_BY_DOCUMENT_SQL,
  hintDocumentLists,
  type MovedStatusRow,
} from './status-hints.ts';

const REQUEUE_BATCH = 200;

/**
 * Re-queue every file a usage limit parked (`RAG_ERROR_USAGE_LIMIT`): the
 * limit may have reset or been raised since. Runs hourly. A file whose
 * limit still binds is parked again by its job's budget check before any
 * bytes are read, so an hour of waiting costs a parked file one check,
 * never a re-extraction; what it had embedded stays, and the run that
 * gets through resumes after it. Batched; a row another transaction holds
 * is skipped and caught by the next pass.
 */
export async function requeueUsageLimitedFiles(
  sql: Sql,
  now: number = Date.now(),
): Promise<number> {
  let total = 0;
  for (;;) {
    const requeued = await sql.begin(async (tx) => {
      const rows = await tx<({ id: string } & MovedStatusRow)[]>`
        WITH picked AS (
          SELECT id FROM app.file_metadata
           WHERE rag_status = 'failed'
             AND rag_error_code = ${RAG_ERROR_USAGE_LIMIT}
             -- Queued before this pass: a file this pass re-queued, which
             -- its job parks again at once, waits for the next pass.
             AND coalesce(rag_queued_at_ms, 0) < ${now}
           ORDER BY id
           LIMIT ${REQUEUE_BATCH}
           FOR UPDATE SKIP LOCKED
        )
        UPDATE app.file_metadata fm
           SET rag_status = 'queued', rag_error = NULL, rag_error_code = NULL,
               rag_queued_at_ms = ${now}
          FROM picked
         WHERE fm.id = picked.id
        RETURNING fm.id, fm.org_id AS "orgId",
                  ${tx.unsafe(HELD_BY_DOCUMENT_SQL)} AS "listed"
      `;
      for (const row of rows) {
        await addJobInTx(tx, 'rag.index_file', { fileId: row.id });
      }
      await hintDocumentLists(tx, rows);
      return rows.length;
    });
    total += requeued;
    if (requeued < REQUEUE_BATCH) return total;
  }
}
