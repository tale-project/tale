import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import type { RagUploadResult } from './types';

export interface UploadFileArgs {
  /**
   * The RAG document id (`file_id`) the content is indexed under. For uploads
   * of a stored file this is the file's Convex `_storage` id (the bytes are
   * read from storage). When `content` is provided, this is just the id key —
   * the bytes come from `content`, not storage (e.g. audio transcripts indexed
   * under the audio file's storageId).
   */
  fileId: string;
  filename: string;
  contentType: string;
  /**
   * Inline bytes to index, as an alternative to reading them from storage by
   * `fileId`. Used when the indexed content is generated in-memory and not the
   * bytes stored under `fileId` (e.g. an audio transcript indexed under the
   * audio's storageId). When omitted, the indexer reads `fileId` from storage.
   */
  content?: Blob;
  /**
   * Per-document metadata to stamp (team_id / source_provider / extension /
   * folder_path, etc.). Applied AFTER indexing via the in-process
   * `updateMetadata` action so it lands on the `documents` row for
   * search-time pre-filtering. May be omitted.
   */
  metadata?: Record<string, unknown>;
  /**
   * Sync vs. async hint from the legacy multipart upload. The in-process
   * indexing pipeline runs synchronously within this action regardless, so
   * `sync` is accepted for source-API compatibility but no longer changes
   * behaviour (kept to avoid touching every caller).
   */
  sync?: boolean;
  /** Required: scopes the org's provider catalog + knowledge-db namespace. */
  orgSlug: string;
}

/**
 * Index a file into the knowledge corpus IN-PROCESS.
 *
 * Replaces the legacy multipart POST to the external RAG service
 * (`/api/v1/documents/upload`). The bytes are read by the
 * `internal.rag.documents.upload` action directly from Convex storage via the
 * passed `fileId` (a `_storage` id), so no Blob round-trips through this
 * function or the action arg wire.
 *
 * The external endpoint accepted a `metadata` form field and stamped it on the
 * `documents` row inline. The in-process indexing pipeline does not yet write
 * per-document metadata/folder_path during indexing, so when `metadata` is
 * supplied it is applied as a follow-up `updateMetadata` (and, for the special
 * `folder_path` key, `updateFolderPaths`) call — matching the
 * upload-then-filterable behaviour the search path depends on.
 */
export async function uploadFile(
  ctx: ActionCtx,
  // `contentType` / `sync` are accepted on `UploadFileArgs` for source-API
  // compatibility but are not needed in-process (content type is derived from
  // the filename/bytes; indexing is synchronous).
  { fileId, filename, content, metadata, orgSlug }: UploadFileArgs,
): Promise<RagUploadResult> {
  const startTime = Date.now();

  // Inline bytes (e.g. a generated transcript) are passed as base64 `content`;
  // otherwise the indexer reads `fileId` from Convex storage.
  const inlineContent =
    content !== undefined
      ? Buffer.from(await content.arrayBuffer()).toString('base64')
      : null;

  const result = await ctx.runAction(internal.rag.documents.upload, {
    orgSlug,
    fileId,
    filename,
    storageId: inlineContent === null ? fileId : null,
    content: inlineContent,
  });

  // Stamp per-document metadata + folder_path post-index so search-time
  // pre-filtering works (the in-process indexer does not persist these
  // during indexing — see module header).
  if (metadata && Object.keys(metadata).length > 0) {
    const { folder_path: folderPath, ...rest } = metadata;
    if (Object.keys(rest).length > 0) {
      // `content_type` was a transport-only key on the legacy upload (it was
      // re-derived RAG-side); drop it so it does not pollute the filterable
      // metadata. The validated `updateMetadata` action rejects reserved
      // keys anyway, but stripping here keeps the call clean.
      const { content_type: _contentType, ...filterable } = rest;
      if (Object.keys(filterable).length > 0) {
        await ctx.runAction(internal.rag.documents.updateMetadata, {
          orgSlug,
          updates: [{ file_id: fileId, metadata: filterable }],
        });
      }
    }
    if (typeof folderPath === 'string' && folderPath.length > 0) {
      await ctx.runAction(internal.rag.documents.updateFolderPaths, {
        orgSlug,
        updates: [{ file_id: fileId, folder_path: folderPath }],
      });
    }
  }

  return {
    success: result.success,
    fileId,
    ragDocumentId: result.file_id,
    chunksCreated: result.chunks_created ?? 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
  };
}
