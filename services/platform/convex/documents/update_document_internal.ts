/**
 * Update a document (internal helper)
 */

import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { buildFolderPath } from '../folders/queries';
import type { BlobRef } from '../lib/storage/blob_ref';
import {
  assertGenericDocumentContentWritable,
  assertRecordContentWritable,
} from './access';

export type UpdateDocumentInternalArgs = {
  documentId: Id<'documents'>;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  fileId?: BlobRef;
  mimeType?: string;
  extension?: string;
  sourceProvider?: string;
  externalItemId?: string;
  contentHash?: string;
  teamId?: string;
  folderId?: Id<'folders'>;
  folderPath?: string;
  /** The caller will dispatch the new blob through the shared RAG admission
   * queue after fileMetadata is linked. Suppress this helper's legacy direct
   * scheduler so replacement does not bypass concurrency limits. */
  deferContentReindex?: boolean;
};

export async function updateDocumentInternal(
  ctx: MutationCtx,
  args: UpdateDocumentInternalArgs,
): Promise<void> {
  await applyDocumentUpdate(ctx, args, 'generic');
}

/**
 * The controlled-record replacement binder's dedicated update seam. Keeping
 * this as a separate function means the registered generic internal mutation
 * has no flag a caller could set to bypass the replacement workflow.
 */
export async function replaceControlledDocumentContentInternal(
  ctx: MutationCtx,
  args: UpdateDocumentInternalArgs,
): Promise<void> {
  await applyDocumentUpdate(ctx, args, 'controlled-replacement');
}

async function applyDocumentUpdate(
  ctx: MutationCtx,
  args: UpdateDocumentInternalArgs,
  mode: 'generic' | 'controlled-replacement',
): Promise<void> {
  const { documentId, contentHash, deferContentReindex, ...updateData } = args;
  const document = await ctx.db.get(documentId);
  if (!document) {
    throw new AppError({
      code: 'DOCUMENT_NOT_FOUND',
      message: 'Document not found',
    });
  }

  // Generic content writers can only mutate uncontrolled rows. Controlled
  // records retain the existing frozen-state errors, while a draft must use
  // the dedicated, attested replacement seam above. Renames/folder moves and
  // metadata edits stay available through the generic helper.
  if (
    updateData.content !== undefined ||
    updateData.fileId !== undefined ||
    updateData.extension !== undefined ||
    updateData.mimeType !== undefined ||
    updateData.sourceProvider !== undefined ||
    updateData.externalItemId !== undefined ||
    contentHash !== undefined
  ) {
    if (mode === 'generic') {
      assertGenericDocumentContentWritable(document);
    } else {
      assertRecordContentWritable(document);
      if (document.record === undefined) {
        throw new AppError({
          code: 'DOCUMENT_NOT_CONTROLLED',
          message: 'This document is not a controlled record.',
        });
      }
    }
  }

  // `projectId`/`teamId` are mutually exclusive (enforced at
  // attachDocumentToProject) — hold the invariant for every caller,
  // including REST and sync paths.
  if (updateData.teamId !== undefined && document.projectId != null) {
    throw new AppError({
      code: 'DOCUMENT_SCOPE_CONFLICT',
      message:
        'A project document cannot be assigned to a team. Detach it from the project first.',
    });
  }

  if (updateData.folderId) {
    const folder = await ctx.db.get(updateData.folderId);
    if (!folder || folder.organizationId !== document.organizationId) {
      throw new AppError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }
    // Folder and document scopes must match (create_document.ts holds the
    // same invariant at insert): a project doc moves only within its own
    // project's folders; a hub doc never moves into a project folder — the
    // latter is an opaque not-found because hub callers (REST PATCH, sync)
    // cannot see project folders.
    if (document.projectId != null) {
      if (folder.projectId !== document.projectId) {
        throw new AppError({
          code: 'DOCUMENT_SCOPE_CONFLICT',
          message:
            'A project document can only live in a folder of the same project',
        });
      }
    } else if (folder.projectId != null) {
      throw new AppError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }
  }

  // Check if file content has changed (by comparing hash)
  const hashChanged =
    contentHash !== undefined && document.contentHash !== contentHash;
  const hasNewFile = updateData.fileId !== undefined;

  // If hash changed and there's a new file, save the old file to history.
  // Controlled records keep history on EVERY blob replace (hash-less callers
  // like the connector update branch included) — an approved snapshot in
  // `record.approvedVersions` must stay addressable and erasable via
  // `historyFiles`. The `includes` dedupe keeps the approve-time append
  // (documents/records.ts) from duplicating the same ref.
  let historyFiles = document.historyFiles ?? [];
  let historyChanged = false;
  const controlledBlobReplace =
    document.record !== undefined &&
    hasNewFile &&
    document.fileId !== undefined &&
    updateData.fileId !== document.fileId;
  if ((hashChanged && hasNewFile && document.fileId) || controlledBlobReplace) {
    historyChanged = true;
    if (document.fileId && !historyFiles.includes(document.fileId)) {
      historyFiles = [...historyFiles, document.fileId];
    }
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

  if (historyChanged) {
    finalUpdateData.historyFiles = historyFiles;
  }

  // Title-only rename on an already-indexed doc: RAG stores the filename at
  // upload time, so the search/citation surface keeps the old name until we
  // re-upload. Same scheduler path as the content-change case;
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
    !deferContentReindex &&
    hashChanged &&
    hasNewFile &&
    wasIndexed &&
    document.fileId;

  const needsFirstTimeIndex =
    !deferContentReindex &&
    hashChanged &&
    hasNewFile &&
    !wasIndexed &&
    currentFm?.ragStatus !== 'running' &&
    updateData.fileId !== undefined;

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
  if (needsFirstTimeIndex) {
    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.uploadDocumentToRag,
      { documentId, expectedFileId: updateData.fileId },
    );
  } else if (needsReindex && oldFileId) {
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
