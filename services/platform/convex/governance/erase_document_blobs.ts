/**
 * Shared blob-eraser for `documents` rows. Single source of truth for
 * the "delete a document AND all its physical bytes" pattern, used by:
 *
 *   - Retention Pass-B (`internal_mutations_retention.ts:deleteExpiredDocument`)
 *   - GDPR Art 17 erasure (`erasure.ts:eraseSubjectDocuments`)
 *
 * Round-2 V5 P0-12: `eraseSubjectDocuments` was deleting the `documents`
 * row and harvesting `doc.fileId` for the RAG fan-out, but never calling
 * `ctx.storage.delete(doc.fileId)` AND ignoring `doc.historyFiles[]`.
 * Retention's bespoke loop did this correctly; the two paths drifted.
 * Lifting the pattern into one helper makes future field additions
 * (e.g., thumbnails, attachments) automatically covered on both routes.
 *
 * The helper does NOT delete the `documents` row itself — the caller
 * is responsible for that (different audit semantics, different cascade
 * timing). It DOES delete:
 *   - the primary `_storage` blob at `doc.fileId`
 *   - every `_storage` blob in `doc.historyFiles[]`
 *   - every `fileMetadata` row pointing at any of the above storageIds
 *
 * RAG-side propagation is the caller's responsibility (it requires HTTP,
 * which mutations can't perform). The retention path is fire-and-forget
 * via a scheduled action; the GDPR processor walks the returned `fileIds`
 * after the mutation returns.
 */
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export interface EraseDocumentBlobsResult {
  /** All `_storage` ids that were physically deleted (primary + history). */
  storageIdsDeleted: string[];
  /** Number of `fileMetadata` rows deleted alongside the blobs. */
  fileMetadataRowsDeleted: number;
}

export async function eraseDocumentBlobs(
  ctx: MutationCtx,
  doc: Doc<'documents'>,
): Promise<EraseDocumentBlobsResult> {
  const storageIdsDeleted: string[] = [];
  let fileMetadataRowsDeleted = 0;

  if (doc.fileId) {
    const fileId = doc.fileId;
    // Mirror the try/catch already used by erasure.ts:658 and
    // internal_mutations_retention.ts:301 — a missing blob (already
    // deleted by a prior partial run) must NOT abort the whole
    // transaction, leaving the documents row permanently behind.
    // Round-2 review HIGH cluster.
    try {
      await ctx.storage.delete(fileId);
    } catch (err) {
      console.warn('[erase_document_blobs] storage.delete failed', {
        fileId: String(fileId),
        err: String(err),
      });
    }
    storageIdsDeleted.push(String(fileId));
    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
      .first();
    if (meta) {
      await ctx.db.delete(meta._id);
      fileMetadataRowsDeleted++;
    }
  }

  if (doc.historyFiles) {
    for (const historyFileId of doc.historyFiles) {
      try {
        await ctx.storage.delete(historyFileId);
      } catch (err) {
        console.warn('[erase_document_blobs] history storage.delete failed', {
          fileId: String(historyFileId),
          err: String(err),
        });
      }
      storageIdsDeleted.push(String(historyFileId));
      const histMeta = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', historyFileId))
        .first();
      if (histMeta) {
        await ctx.db.delete(histMeta._id);
        fileMetadataRowsDeleted++;
      }
    }
  }

  return { storageIdsDeleted, fileMetadataRowsDeleted };
}
