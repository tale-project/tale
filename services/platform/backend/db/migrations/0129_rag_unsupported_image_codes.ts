/**
 * 0.5 app migration 0129: the cause on a bare `unsupported` image.
 *
 * From #3183 until #3353 the indexer landed an image on `unsupported` with
 * the vision sentence and no `rag_error_code`: its image branch predates the
 * code. On those rows REST `indexing.errorCode` is absent although the
 * contract promises a code on every `unsupported`, and the badge's dialog has
 * no cause to branch on. The indexer now writes `image_no_vision`
 * (`unsupportedByName`); this gives the rows it wrote before the same pair.
 *
 * Here the name does tell the cause, where `0128` had to leave the row
 * alone: a bare `unsupported` with an image name has no other writer. The
 * replacement lane queued images (its indexable set carries the same image
 * extensions), and an empty extraction landed on `failed`, never on
 * `unsupported`. A bare row whose file an extractor reads and which is no
 * image (`.txt`, `.pdf`) stays as it is — its name cannot tell an empty file
 * from a damaged one.
 *
 * Its own number rather than an edit of `0128`: a database that already
 * applied `0128` never runs it again. A TypeScript data migration because
 * which names are images is the extractor router's own `isImageFile()`.
 * Every statement is written here, against the schema as it stood at 0129:
 * a database that jumps past several releases runs this with the newest
 * image's code, so only pure rules are imported (`DataMigration`).
 *
 * Idempotent: a re-run finds no bare image row. Bounded: only rows already
 * `unsupported` with no code are read. Rolling-deploy safe: the previous
 * image reads both columns as before and writes the same pair for an image.
 * The open document lists of an organization whose listed rows were filled
 * refetch once, as they would for the status write itself.
 */

import type { TransactionSql } from 'postgres';

import { RAG_ERROR_IMAGE_NO_VISION } from '../../core/knowledge/rag_error_codes.ts';
import { imageNoVisionError } from '../../core/knowledge/rag_unsupported.ts';
import { isImageFile } from '../../core/lib/knowledge/extraction/router.ts';

export async function migrate(tx: TransactionSql): Promise<void> {
  const bare = await tx<{ id: string; fileName: string }[]>`
    SELECT id, file_name AS "fileName"
    FROM app.file_metadata
    WHERE rag_status = 'unsupported' AND rag_error_code IS NULL
    FOR UPDATE
  `;
  const images = bare.filter((row) => isImageFile(row.fileName));
  if (images.length === 0) return;
  // `listed`: a document holds the file, so a document list shows its status
  // — an attachment's is on no list.
  const filled = await tx<{ orgId: string; listed: boolean }[]>`
    UPDATE app.file_metadata fm SET
      rag_error_code = ${RAG_ERROR_IMAGE_NO_VISION},
      rag_error = v.error,
      rag_progress = NULL
    FROM unnest(
      ${images.map((row) => row.id)}::text[],
      ${images.map((row) => imageNoVisionError(row.fileName))}::text[]
    ) AS v(id, error)
    WHERE fm.id = v.id
      AND fm.rag_status = 'unsupported' AND fm.rag_error_code IS NULL
    RETURNING fm.org_id AS "orgId",
              EXISTS (
                SELECT 1 FROM app.documents d
                WHERE d.org_id = fm.org_id AND d.file_ref = fm.storage_ref
              ) AS "listed"
  `;
  const orgIds = [
    ...new Set(filled.filter((row) => row.listed).map((row) => row.orgId)),
  ];
  if (orgIds.length === 0) return;
  // One org-wide `document` hint per organization, the realtime outbox's row.
  await tx`
    INSERT INTO app_realtime.outbox (org_id, user_id, entity, entity_id)
    SELECT org_id, NULL, 'document', NULL
    FROM unnest(${orgIds}::text[]) AS o(org_id)
  `;
}
