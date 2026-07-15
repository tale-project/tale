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
 *
 * Backend split: a blob is EITHER a Convex `_storage` id (deleted inline here)
 * OR an `s3:<key>` ref in the org's own bucket. A mutation cannot sign an S3
 * request (needs the node runtime), so `s3:` refs are batched and handed to the
 * scheduled `internal.files.blob_actions.deleteOrgBlobs` action instead. Convex
 * blobs keep today's inline delete — zero regression for deployment-default orgs.
 */
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { convexStorageId, type BlobRef } from '../lib/storage/blob_ref';

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
  const s3RefsToDelete: string[] = [];
  let fileMetadataRowsDeleted = 0;

  // Primary blob first (kept ahead of history for stable accounting), then
  // every history revision. Both fields now hold blob REFERENCES (`_storage` id
  // or `s3:` ref); `convexStorageId` narrows to the id for the inline delete.
  const refs: BlobRef[] = [];
  if (doc.fileId) refs.push(doc.fileId);
  if (doc.historyFiles) refs.push(...doc.historyFiles);

  for (const ref of refs) {
    const convexId = convexStorageId(ref);
    if (convexId !== null) {
      // Mirror the try/catch already used by erasure.ts:658 and
      // internal_mutations_retention.ts:301 — a missing blob (already
      // deleted by a prior partial run) must NOT abort the whole
      // transaction, leaving the documents row permanently behind.
      // Round-2 review HIGH cluster.
      try {
        await ctx.storage.delete(convexId);
      } catch (err) {
        console.warn('[erase_document_blobs] storage.delete failed', {
          fileId: String(ref),
          err: String(err),
        });
      }
    } else {
      // S3-backed: defer to the scheduled node action (can't sign here).
      s3RefsToDelete.push(String(ref));
    }
    storageIdsDeleted.push(String(ref));
    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', ref))
      .first();
    if (meta) {
      await ctx.db.delete(meta._id);
      fileMetadataRowsDeleted++;
    }
  }

  // Fire-and-forget the physical S3 deletes (idempotent, best-effort). Deferring
  // to a scheduled action keeps this mutation transactional and never blocks the
  // row delete on a slow/unreachable bucket.
  if (s3RefsToDelete.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.files.blob_actions.deleteOrgBlobs,
      { organizationId: doc.organizationId, refs: s3RefsToDelete },
    );
  }

  return { storageIdsDeleted, fileMetadataRowsDeleted };
}
