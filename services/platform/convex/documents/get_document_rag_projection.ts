/**
 * Read-side projection of a document's RAG indexing status.
 *
 * RAG status lives canonically on `fileMetadata.ragStatus` (join:
 * `documents.fileId == fileMetadata.storageId`, 1:1). The retired
 * `documents.ragInfo`/`indexed` fields are no longer written — every read that
 * used to consume them goes through this helper instead, so the projected shape
 * stays identical and the frontend is unchanged.
 *
 * A document with no `fileId`, or whose blob has no fileMetadata row, projects
 * as `{ indexed: false, status: undefined }` — the UI renders that as
 * `not_indexed`.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { BlobRef } from '../lib/storage/blob_ref';

export interface DocumentRagProjection {
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';
  indexedAt?: number;
  error?: string;
  /** Machine-readable cause for guidable failures (knowledge/rag_error_codes). */
  errorCode?: string;
  indexed: boolean;
}

const NOT_INDEXED: DocumentRagProjection = { indexed: false };

function projectFromFileMetadata(
  fm: Doc<'fileMetadata'> | null,
): DocumentRagProjection {
  if (!fm) return NOT_INDEXED;
  return {
    status: fm.ragStatus,
    indexedAt: fm.ragIndexedAt,
    error: fm.ragError,
    errorCode: fm.ragErrorCode,
    indexed: fm.ragStatus === 'completed',
  };
}

/** Single-document projection. */
export async function getDocumentRagProjection(
  ctx: QueryCtx,
  doc: Pick<Doc<'documents'>, 'fileId'>,
): Promise<DocumentRagProjection> {
  const fileId = doc.fileId;
  if (!fileId) return NOT_INDEXED;
  const fm = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
    .first();
  return projectFromFileMetadata(fm);
}

/**
 * Batch projection keyed by document `_id`. Looks up each distinct `fileId`
 * once on `by_storageId`. Mirrors the `batchGetStorageUrls` pattern in
 * `transform_to_document_item.ts`.
 */
export async function getDocumentRagProjectionBatch(
  ctx: QueryCtx,
  docs: Array<Pick<Doc<'documents'>, '_id' | 'fileId'>>,
): Promise<Map<string, DocumentRagProjection>> {
  const result = new Map<string, DocumentRagProjection>();
  if (docs.length === 0) return result;

  // Deduplicate fileIds so a blob shared by multiple docs is fetched once.
  const seen = new Set<string>();
  const uniqueFileIds: BlobRef[] = [];
  for (const d of docs) {
    if (!d.fileId) continue;
    const key = String(d.fileId);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFileIds.push(d.fileId);
    }
  }

  const byFileId = new Map<string, DocumentRagProjection>();
  await Promise.all(
    uniqueFileIds.map(async (fileId) => {
      const fm = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
        .first();
      byFileId.set(String(fileId), projectFromFileMetadata(fm));
    }),
  );

  for (const d of docs) {
    const proj = d.fileId
      ? (byFileId.get(String(d.fileId)) ?? NOT_INDEXED)
      : NOT_INDEXED;
    result.set(String(d._id), proj);
  }
  return result;
}
