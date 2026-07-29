import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { createDocument } from '../documents/create_document';
import { getOrCreateFolderPath } from '../folders/get_or_create_path';
import { blobRefValidator, type BlobRef } from '../lib/storage/blob_ref';
import {
  KNOWLEDGE_ENTRIES_FOLDER,
  KNOWLEDGE_SOURCE_PROVIDER,
} from './constants';

/**
 * Write side of the entry→document materialization. The chat-era
 * `knowledge_write` approval mutations retired with the old capability
 * surface; they return with the approve-first knowledge tool.
 */

export const attachEntryDocument = internalMutation({
  args: {
    entryId: v.id('knowledgeEntries'),
    fileId: blobRefValidator,
    contentHash: v.string(),
  },
  returns: v.union(v.id('documents'), v.null()),
  handler: async (ctx, args): Promise<Id<'documents'> | null> => {
    const entry = await ctx.db.get(args.entryId);
    // Entry deleted or superseded while the blob was being stored — a newer
    // version (or nothing) owns the backing document now.
    if (!entry || entry.deletedAt !== undefined || entry.status !== 'active') {
      return null;
    }

    const title = `${entry.topic}.md`;
    const existingDoc = entry.documentId
      ? await ctx.db.get(entry.documentId)
      : null;

    if (existingDoc) {
      const oldFileId = existingDoc.fileId;
      await ctx.db.patch(existingDoc._id, {
        title,
        fileId: args.fileId,
        mimeType: 'text/markdown',
        extension: 'md',
        contentHash: args.contentHash,
        ...(oldFileId
          ? { historyFiles: [...(existingDoc.historyFiles ?? []), oldFileId] }
          : {}),
      });
      await linkFileMetadataToDocument(ctx, args.fileId, existingDoc._id);

      if (oldFileId) {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.reindexDocumentInRag,
          {
            documentId: existingDoc._id,
            oldFileId,
            oldOrganizationId: existingDoc.organizationId,
          },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.uploadDocumentToRag,
          { documentId: existingDoc._id },
        );
      }
      return existingDoc._id;
    }

    const folderId = await getOrCreateFolderPath(
      ctx,
      entry.organizationId,
      [KNOWLEDGE_ENTRIES_FOLDER],
      entry.createdBy,
    );

    const { documentId } = await createDocument(ctx, {
      organizationId: entry.organizationId,
      title,
      fileId: args.fileId,
      mimeType: 'text/markdown',
      extension: 'md',
      contentHash: args.contentHash,
      sourceProvider: KNOWLEDGE_SOURCE_PROVIDER,
      createdBy: entry.createdBy,
      folderId,
    });

    await linkFileMetadataToDocument(ctx, args.fileId, documentId);
    await ctx.db.patch(args.entryId, { documentId });

    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.uploadDocumentToRag,
      { documentId },
    );
    return documentId;
  },
});

async function linkFileMetadataToDocument(
  ctx: MutationCtx,
  storageId: BlobRef,
  documentId: Id<'documents'>,
): Promise<void> {
  const metadata = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (!metadata) {
    console.warn(
      `[attachEntryDocument] No fileMetadata for storageId ${storageId}; skipping document link`,
    );
    return;
  }
  await ctx.db.patch(metadata._id, { documentId });
}
