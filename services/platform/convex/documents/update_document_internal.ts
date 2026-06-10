/**
 * Update a document (internal helper)
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { buildFolderPath } from '../folders/queries';

export type UpdateDocumentInternalArgs = {
  documentId: Id<'documents'>;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  sourceProvider?: string;
  externalItemId?: string;
  contentHash?: string;
  teamId?: string;
  folderId?: Id<'folders'>;
  folderPath?: string;
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

  if (updateData.folderId) {
    const folder = await ctx.db.get(updateData.folderId);
    if (!folder || folder.organizationId !== document.organizationId) {
      throw new Error('Folder not found');
    }
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

  // Sync folderPath when folderId changes
  if (updateData.folderId !== undefined) {
    updateData.folderPath = updateData.folderId
      ? await buildFolderPath(ctx, updateData.folderId)
      : undefined;
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

  // Title-only rename on an already-indexed doc: RAG stores the filename at
  // upload time, so the search/citation surface keeps the old name until we
  // delete and re-upload. Same scheduler path as the content-change case;
  // `reindexDocumentInRag` reads the (just-patched) new title at upload.
  const titleChanged =
    updateData.title !== undefined && document.title !== updateData.title;

  // Re-index gate reads canonical fileMetadata.ragStatus for the doc's current
  // blob (documents.ragInfo is retired). The fileMetadata pipeline owns the
  // flip to 'queued' when reindexDocumentInRag re-uploads, so status is not
  // written here.
  const currentFileId = document.fileId;
  const currentFm = currentFileId
    ? await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', currentFileId))
        .first()
    : null;
  const wasIndexed = currentFm?.ragStatus === 'completed';

  // If file/title changed and the document was RAG-indexed, re-index.
  const needsContentReindex =
    hashChanged && hasNewFile && wasIndexed && document.fileId;

  const needsTitleReindex =
    titleChanged && !hashChanged && wasIndexed && document.fileId;

  const needsReindex = needsContentReindex || needsTitleReindex;

  // Remove undefined values
  const cleanUpdateData = Object.fromEntries(
    Object.entries(finalUpdateData).filter(([_, value]) => value !== undefined),
  );

  const oldFileId = document.fileId;

  if (Object.keys(cleanUpdateData).length > 0) {
    await ctx.db.patch(documentId, cleanUpdateData);
  }

  // Schedule RAG re-index after the patch. Pass `organizationId`
  // explicitly so the action can purge the *old* RAG entry even if
  // the document row is later deleted/cleared before the scheduled
  // job fires — otherwise the orphan oldFileId chunks survive
  // forever (round-3 P2 R4-P2-a).
  if (needsReindex && oldFileId) {
    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.reindexDocumentInRag,
      {
        documentId,
        oldFileId,
        oldOrganizationId: document.organizationId,
      },
    );
  }

  // Folder move on an indexed doc: RAG keeps a denormalized folder_path
  // for folder-scoped search, and a move alone never re-uploads — sync
  // it explicitly. Skipped when a re-index is scheduled (the re-upload
  // carries the new folder path itself).
  const folderMoved =
    updateData.folderId !== undefined &&
    updateData.folderId !== document.folderId;
  if (folderMoved && wasIndexed && currentFileId && !needsReindex) {
    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.syncRagFolderPaths,
      {
        organizationId: document.organizationId,
        updates: [{ fileId: currentFileId, folderPath: updateData.folderPath }],
      },
    );
  }
}
