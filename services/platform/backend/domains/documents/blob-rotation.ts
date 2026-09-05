import type { TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * Rotate the blob a refresh replaced out of existence: the previous bytes'
 * file row is unbound and trashed so the liveness predicate reads it dead,
 * and the durable `knowledge.release_refs` job (enqueued in this
 * transaction, run after commit) de-indexes and deletes the bytes — the
 * replacement lane's idiom. Shared by the agent refresh and the project-text
 * rewrite: before it, every re-run of a report-writing automation left the
 * previous blob bound, active and counted against the uploader's quota
 * forever; a purge released only the current ref.
 */
export async function releasePreviousBlob(
  tx: TransactionSql,
  args: { organizationId: string; documentId: string; previousFileRef: string },
): Promise<void> {
  await tx`
    UPDATE app.file_metadata SET
      document_id = NULL, lifecycle_status = 'trashed',
      status_changed_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId}
      AND document_id = ${args.documentId}
      AND storage_ref = ${args.previousFileRef}
  `;
  await addJobInTx(tx, 'knowledge.release_refs', {
    organizationId: args.organizationId,
    refs: [args.previousFileRef],
  });
}
