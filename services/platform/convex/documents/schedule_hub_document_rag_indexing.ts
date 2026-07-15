/**
 * Schedule RAG indexing for a Document Hub file once the document row is
 * fully wired (fileId, folderPath, link to fileMetadata).
 */

import {
  isRagIndexableFile,
  resolveFileType,
} from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { maybeDispatchRagIndexing } from '../file_metadata/rag_dispatch';

/**
 * Enqueue `uploadDocumentToRag` when the blob is indexable and not already
 * indexed or actively running. Returns whether a job was scheduled.
 */
export async function scheduleHubDocumentRagIndexing(
  ctx: MutationCtx,
  args: { documentId: Id<'documents'> },
): Promise<boolean> {
  const document = await ctx.db.get(args.documentId);
  if (!document?.fileId) return false;
  const fileId = document.fileId;

  const fm = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
    .first();

  // Chat-bound attachments index via saveFileMetadata → uploadFileToRag.
  if (fm?.threadId) return false;

  const fileName = document.title ?? fm?.fileName ?? 'document';
  const contentType = resolveFileType(
    fileName,
    document.mimeType ?? fm?.contentType ?? 'application/octet-stream',
  );
  if (!isRagIndexableFile(fileName, contentType)) return false;

  if (fm?.ragStatus === 'completed' || fm?.ragStatus === 'running') {
    return false;
  }

  // Route through the same per-org + global concurrency cap as the direct
  // upload path so a bulk import (e.g. OneDrive) can't fire dozens of
  // `uploadDocumentToRag` actions at once and saturate the shared knowledge-db
  // pool. Mark the row `queued` (so the dispatcher's guard passes and it counts
  // against the cap), then let `maybeDispatchRagIndexing` dispatch it now or
  // park it for the fair promoter — which dispatches `uploadDocumentToRag`
  // because the row carries `documentId` (see `dispatchRow`).
  if (fm) {
    await ctx.db.patch(fm._id, {
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragParked: undefined,
      ragQueuedAt: Date.now(),
    });
    await maybeDispatchRagIndexing(ctx, fileId);
    return true;
  }

  // No `fileMetadata` row yet (workflow-created / legacy file-backed docs):
  // dispatch directly — `uploadDocumentToRag` creates the row via
  // `ensureFileMetadataForDocument`, and the watchdog covers it.
  await ctx.scheduler.runAfter(
    0,
    internal.documents.internal_actions.uploadDocumentToRag,
    { documentId: args.documentId },
  );
  return true;
}
