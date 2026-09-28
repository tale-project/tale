import type { Sql, TransactionSql } from 'postgres';

import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * Who is told that a file's indexing status moved — one rule for every lane
 * that writes it: the indexer's own writes (`writeRagStatus`), the RAG
 * watchdog, the index-health requeue and re-stamp, and the embedding
 * requeue.
 *
 * The document list renders the status (`ragStatus`, joined onto the file
 * row by blob ref), and a browser only refetches when a hint names the entity
 * it is holding. Org-wide (`entityId: null`): the status lives on the FILE
 * row while the surface is keyed by DOCUMENT, and the list is what has to
 * re-read. Hints carry identity, never data, so the breadth costs one
 * refetch of a page the user is already looking at — once per organization,
 * however many rows one write moved.
 *
 * A row no document holds is an attachment — a chat, task or email file. No
 * list shows it: its status is read by the composer's own poll
 * (`/files/statuses`) and the chat turn, so a hint for it would only make
 * every open Documents list in the organization refetch for nothing. A lane
 * that writes the status before its document holds the file emits the
 * document's own hint when it does.
 *
 * Its own module so the lanes that write the status need not load the
 * knowledge service to tell the lists.
 */

/**
 * The file rows a document list shows, as SQL over a file row aliased `fm`:
 * those a document holds as its current blob. Every list renders the status
 * through exactly this join (`documents.file_ref` = the row's `storage_ref`,
 * indexed as `documents_org_file_ref`), and the one door that starts an index
 * run by hand (`queueRagIndexingRetry`, behind Index now and Reindex) reaches
 * a file the same way. A status write selects it `AS "listed"`.
 */
export const HELD_BY_DOCUMENT_SQL =
  'EXISTS (SELECT 1 FROM app.documents d ' +
  'WHERE d.org_id = fm.org_id AND d.file_ref = fm.storage_ref)';

/** A moved row as {@link hintDocumentLists} reads it: the row's
 * organization, and whether a document holds it
 * ({@link HELD_BY_DOCUMENT_SQL} `AS "listed"`). */
export interface MovedStatusRow {
  readonly orgId: string;
  readonly listed: boolean;
}

/**
 * Tell the document lists of every organization with a listed row among
 * `rows` that statuses moved: one org-wide `document` hint per organization,
 * inside the caller's transaction (or right after its statement, for a lane
 * that writes without one). Nothing for rows no list shows.
 */
export async function hintDocumentLists(
  sql: Sql | TransactionSql,
  rows: readonly MovedStatusRow[],
): Promise<void> {
  const orgIds = new Set(
    rows.filter((row) => row.listed).map((row) => row.orgId),
  );
  for (const orgId of orgIds) {
    await emitHintInTx(sql, { orgId, entity: 'document', entityId: null });
  }
}
