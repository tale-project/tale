import type { Fragment, Sql, TransactionSql } from 'postgres';

import { taskHoldsBlobRef } from '../tasks/blob-holders.ts';

/**
 * May the BYTES of a blob ref go? Not while some row of the organization
 * still holds the ref:
 *
 *  - a file row (`app.file_metadata.storage_ref`), whatever its lifecycle —
 *    a trashed row is restorable, and its purge goes through the release
 *    seam, which judges the bytes again then;
 *  - a document, as its current file (`file_ref`) or as a retained version
 *    (`history_files` — controlled-record snapshots need their bytes);
 *  - a task, as an attachment or a deliverable (`tasks/blob-holders.ts`).
 *
 * ONE predicate for every lane that deletes bytes outside the release seam:
 * `deleteFile` once its own row is gone, the abandoned-upload sweep and the
 * rejected-upload reclaim (`upload-intents.ts`), and a product's released
 * managed image (`products/service.ts`). Each lane used to carry its own
 * copy, and a copy that missed a holder deleted that holder's bytes: the
 * reclaim asked about file rows alone and took a task's attachment
 * (2026-10-03, #4104); the product image release asked about file rows and
 * current documents and took one too (#4110). A new holder joins here, once,
 * for all of them. The
 * release seam (`knowledge/liveness.ts`) asks a sibling question in the
 * middle of a purge — live rows only, minus the document or file row being
 * purged — and keeps its own statement for that reason.
 *
 * `ref` is a fragment, as in `taskHoldsBlobRef`: a parameter
 * (``sql`${ref}` ``) or a column of the caller's query (``sql`i.s3_ref` ``).
 */
export function blobRefHeld(
  sql: Sql | TransactionSql,
  organizationId: string,
  ref: Fragment,
): Fragment {
  return sql`(EXISTS (
    SELECT 1 FROM app.file_metadata held_file
    WHERE held_file.org_id = ${organizationId}
      AND held_file.storage_ref = ${ref}
  ) OR EXISTS (
    SELECT 1 FROM app.documents held_doc
    WHERE held_doc.org_id = ${organizationId}
      AND (held_doc.file_ref = ${ref}
           OR held_doc.history_files @> ARRAY[${ref}::text])
  ) OR ${taskHoldsBlobRef(sql, organizationId, ref)})`;
}
