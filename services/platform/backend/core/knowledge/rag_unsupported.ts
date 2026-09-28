/**
 * The terminal `unsupported` a file's NAME decides, before a byte is read —
 * the indexer's own rule (`indexUploadedFile`), read here by every lane that
 * has to agree with it: the lanes that store a file without queueing it, the
 * `rag_fetch` miss (which must never send the model to index such a file),
 * and the data migrations that give rows written before a lane carried the
 * code their cause.
 *
 * Pure on purpose — a function of the name, no SQL and no I/O — so a data
 * migration may import it (`DataMigration` in `backend/db/migrate.ts`). The
 * code literals stay in the dependency-free `rag_error_codes.ts`, which the
 * client imports too.
 */

import {
  isImageFile,
  isSupported,
} from '../lib/knowledge/extraction/router.ts';
import {
  RAG_ERROR_IMAGE_NO_VISION,
  RAG_ERROR_UNSUPPORTED_TYPE,
} from './rag_error_codes.ts';

/** The sentence `unsupported_type` carries — the failed-indexing dialog, REST
 * `indexing.error` and the retry door's refusal all print it. */
export function unsupportedTypeError(fileName: string): string {
  return `No text extractor exists for "${fileName}".`;
}

/** The sentence `image_no_vision` carries, printed where the one above is. */
export function imageNoVisionError(fileName: string): string {
  return (
    `Images cannot be indexed for search: no vision (OCR) model lane is ` +
    `available to read "${fileName}".`
  );
}

/** A terminal cause the name decides, with the sentence it carries. */
export interface UnsupportedCause {
  readonly code:
    | typeof RAG_ERROR_UNSUPPORTED_TYPE
    | typeof RAG_ERROR_IMAGE_NO_VISION;
  readonly error: string;
}

/**
 * What an index run answers for this name alone: `unsupported_type` when no
 * extractor reads the type, `image_no_vision` for an image. Images route to
 * the vision extractor, and the vision seam is retired
 * (`extraction/vision_client.ts`): with no client an image can only ever
 * yield '' — which once landed as 'failed — Indexing skipped (empty)', a
 * badge inviting a retry of a capability that does not exist. Drop that leg
 * when the vision lane returns and a client is wired in. Null when the name
 * leaves the answer to the bytes.
 */
export function unsupportedByName(fileName: string): UnsupportedCause | null {
  if (!isSupported(fileName)) {
    return {
      code: RAG_ERROR_UNSUPPORTED_TYPE,
      error: unsupportedTypeError(fileName),
    };
  }
  if (isImageFile(fileName)) {
    return {
      code: RAG_ERROR_IMAGE_NO_VISION,
      error: imageNoVisionError(fileName),
    };
  }
  return null;
}
