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

  await ctx.scheduler.runAfter(
    0,
    internal.documents.internal_actions.uploadDocumentToRag,
    { documentId: args.documentId },
  );
  return true;
}
