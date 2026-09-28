/**
 * 0.5 app migration 0128: the cause on a bare `unsupported`.
 *
 * A controlled-record replacement used to insert a file no extractor reads
 * (`.doc`, `.xls`, `.ppt`, `.ac2`) as a bare `unsupported`: no
 * `rag_error_code`, no sentence. On those rows REST `indexing.errorCode` is
 * absent although the contract promises a code on every `unsupported`, the
 * badge's dialog has no cause to print, and the retry door refuses with its
 * generic sentence. The lane now writes what every lane writes
 * (`markRagUnsupportedIfNoExtractor`): `unsupported_type` with the indexer's
 * sentence. This gives the rows it wrote before the same pair.
 *
 * A TypeScript data migration because the decision is the indexer's own
 * `isSupported()`: a list of extensions here would be a second copy of the
 * extractor set. A bare row whose file an extractor DOES read is left as it
 * is — its name cannot tell the cause (an image, an empty or damaged file),
 * and naming one would be a guess.
 *
 * Idempotent: a re-run finds no bare row it can fill. Bounded: only rows
 * already `unsupported` with no code are read. Rolling-deploy safe: the
 * previous image reads both columns as before and writes the same pair on
 * every lane. The open document lists of an organization whose listed rows
 * were filled refetch once, as they would for the status write itself.
 */

import type { TransactionSql } from 'postgres';

import { RAG_ERROR_UNSUPPORTED_TYPE } from '../../core/knowledge/rag_error_codes.ts';
import { isSupported } from '../../core/lib/knowledge/extraction/router.ts';
import {
  HELD_BY_DOCUMENT_SQL,
  unsupportedTypeError,
} from '../../domains/knowledge/service.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

export async function migrate(tx: TransactionSql): Promise<void> {
  const bare = await tx<{ id: string; fileName: string }[]>`
    SELECT id, file_name AS "fileName"
    FROM app.file_metadata
    WHERE rag_status = 'unsupported' AND rag_error_code IS NULL
    FOR UPDATE
  `;
  const unread = bare.filter((row) => !isSupported(row.fileName));
  if (unread.length === 0) return;
  const filled = await tx<{ orgId: string; listed: boolean }[]>`
    UPDATE app.file_metadata fm SET
      rag_error_code = ${RAG_ERROR_UNSUPPORTED_TYPE},
      rag_error = v.error,
      rag_progress = NULL
    FROM unnest(
      ${unread.map((row) => row.id)}::text[],
      ${unread.map((row) => unsupportedTypeError(row.fileName))}::text[]
    ) AS v(id, error)
    WHERE fm.id = v.id
      AND fm.rag_status = 'unsupported' AND fm.rag_error_code IS NULL
    RETURNING fm.org_id AS "orgId",
              ${tx.unsafe(HELD_BY_DOCUMENT_SQL)} AS "listed"
  `;
  const orgIds = new Set(
    filled.filter((row) => row.listed).map((row) => row.orgId),
  );
  for (const orgId of orgIds) {
    await emitHintInTx(tx, { orgId, entity: 'document', entityId: null });
  }
}
