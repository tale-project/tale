import type { Sql } from 'postgres';

import { RAG_ERROR_USAGE_LIMIT } from '../../core/knowledge/rag_error_codes.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { DirectCallSubject } from '../governance/direct-calls.ts';
import { embeddingBlocked } from './embedding-meter.ts';
import { fileIndexingSubject } from './service.ts';
import {
  HELD_BY_DOCUMENT_SQL,
  hintDocumentLists,
  type MovedStatusRow,
} from './status-hints.ts';

/** Parked files read per page. */
const REQUEUE_BATCH = 200;

/** The most files one pass queues again: a burst after a limit resets is
 * spread over passes, so the files it queues do not wait in the queue past
 * the RAG watchdog's patience. */
const MAX_REQUEUE_PER_PASS = 1_000;

interface ParkedFileRow {
  id: string;
  organizationId: string;
  storageRef: string;
  documentId: string | null;
  uploadedBy: string | null;
  projectId: string | null;
  threadId: string | null;
}

/** One verdict per subject a pass meets: every file of one uploader in one
 * project waits on the same caps. */
function subjectKey(organizationId: string, subject: DirectCallSubject) {
  return [
    organizationId,
    subject.userId,
    subject.apiKeyId ?? '',
    [...(subject.projectIds ?? [])].sort().join(','),
  ].join('\u0000');
}

/**
 * Queue again the files a usage limit parked (`RAG_ERROR_USAGE_LIMIT`) whose
 * limits have room now: the limit reset, or was raised. Runs hourly. Each
 * file's subject is asked first — once per subject — whether its next
 * embedding request would be admitted (`embeddingBlocked`), so a file whose
 * limit still binds stays parked: an hour of waiting costs it one check,
 * never a trip through the queue or a re-extraction. What it had embedded
 * stays, and the run that gets through resumes after it. Walks every
 * parked file in pages; a row another transaction holds is skipped and
 * caught by the next pass.
 */
export async function requeueUsageLimitedFiles(
  sql: Sql,
  now: number = Date.now(),
): Promise<number> {
  const blockedBySubject = new Map<string, boolean>();
  let total = 0;
  let after = '';
  for (;;) {
    const rows = await sql<ParkedFileRow[]>`
      SELECT id, org_id AS "organizationId", storage_ref AS "storageRef",
             document_id AS "documentId", uploaded_by AS "uploadedBy",
             project_id AS "projectId", thread_id AS "threadId"
      FROM app.file_metadata
      WHERE rag_status = 'failed'
        AND rag_error_code = ${RAG_ERROR_USAGE_LIMIT}
        -- Queued before this pass: a file this pass queued again waits for
        -- the next one.
        AND coalesce(rag_queued_at_ms, 0) < ${now}
        AND id > ${after}
      ORDER BY id
      LIMIT ${REQUEUE_BATCH}
    `;
    const ready: string[] = [];
    for (const row of rows) {
      if (total + ready.length >= MAX_REQUEUE_PER_PASS) break;
      const subject = await fileIndexingSubject(sql, row);
      const key = subjectKey(row.organizationId, subject);
      let blocked = blockedBySubject.get(key);
      if (blocked === undefined) {
        blocked =
          (await embeddingBlocked(sql, {
            organizationId: row.organizationId,
            subject,
          })) !== null;
        blockedBySubject.set(key, blocked);
      }
      if (!blocked) ready.push(row.id);
    }
    if (ready.length > 0) total += await requeueFiles(sql, ready, now);
    const last = rows[rows.length - 1];
    if (
      last === undefined ||
      rows.length < REQUEUE_BATCH ||
      total >= MAX_REQUEUE_PER_PASS
    ) {
      return total;
    }
    after = last.id;
  }
}

/** Queue these parked files again — each still parked by a usage limit and
 * held by no other transaction — with their jobs, in one transaction. */
async function requeueFiles(
  sql: Sql,
  fileIds: readonly string[],
  now: number,
): Promise<number> {
  return await sql.begin(async (tx) => {
    const rows = await tx<({ id: string } & MovedStatusRow)[]>`
      WITH picked AS (
        SELECT id FROM app.file_metadata
         WHERE id = ANY(${[...fileIds]})
           AND rag_status = 'failed'
           AND rag_error_code = ${RAG_ERROR_USAGE_LIMIT}
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
}
