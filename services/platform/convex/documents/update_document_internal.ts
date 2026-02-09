/**
 * Update a document (internal helper)
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export type UpdateDocumentInternalArgs = {
  documentId: Id<'documents'>;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  sourceProvider?: 'onedrive' | 'upload' | 'sharepoint';
  externalItemId?: string;
  contentHash?: string;
  teamTags?: string[];
};

export async function updateDocumentInternal(
  ctx: MutationCtx,
  args: UpdateDocumentInternalArgs,
): Promise<void> {
  const { documentId, contentHash, ...updateData } = args;
  const document = await ctx.db.get(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  // Check if file content has changed (by comparing hash)
  const hashChanged =
    contentHash !== undefined && document.contentHash !== contentHash;
  const hasNewFile = updateData.fileId !== undefined;

  // If hash changed and there's a new file, save the old file to history
  let historyFiles = document.historyFiles ?? [];
  if (hashChanged && hasNewFile && document.fileId) {
    historyFiles = [...historyFiles, document.fileId];
  }

  // Build update data
  const finalUpdateData: Record<string, unknown> = {
    ...updateData,
  };

  if (contentHash !== undefined) {
    finalUpdateData.contentHash = contentHash;
  }

  if (hashChanged && hasNewFile) {
    finalUpdateData.historyFiles = historyFiles;
  }

  // Remove undefined values
  const cleanUpdateData = Object.fromEntries(
    Object.entries(finalUpdateData).filter(([_, value]) => value !== undefined),
  );

  if (Object.keys(cleanUpdateData).length > 0) {
    await ctx.db.patch(documentId, cleanUpdateData);
  }
}
