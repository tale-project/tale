import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { deleteStorageWithMetadata } from '../file_metadata/helpers';

export const deleteExpiredDocument = internalMutation({
  args: {
    documentId: v.id('documents'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) {
      return null;
    }

    if (doc.fileId) {
      const fileId = doc.fileId;
      await ctx.storage.delete(fileId);

      const metadata = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
        .first();
      if (metadata) {
        await ctx.db.delete(metadata._id);
      }
    }

    if (doc.historyFiles) {
      for (const historyFileId of doc.historyFiles) {
        await ctx.storage.delete(historyFileId);

        const histMeta = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', historyFileId))
          .first();
        if (histMeta) {
          await ctx.db.delete(histMeta._id);
        }
      }
    }

    await ctx.db.delete(args.documentId);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'document.retention_deleted',
      category: 'data',
      resourceType: 'document',
      resourceId: String(args.documentId),
      resourceName: doc.title ?? 'Untitled',
      status: 'success',
    });

    return null;
  },
});

export const deleteExpiredTempFile = internalMutation({
  args: {
    fileMetadataId: v.id('fileMetadata'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const metadata = await ctx.db.get(args.fileMetadataId);
    if (!metadata) {
      return null;
    }

    await deleteStorageWithMetadata(ctx, metadata.storageId);
    return null;
  },
});
