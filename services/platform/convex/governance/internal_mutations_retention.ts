import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { deleteStorageWithMetadata } from '../file_metadata/helpers';

export const deleteExpiredDocument = internalMutation({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) {
      return null;
    }

    if (doc.fileId) {
      await ctx.storage.delete(doc.fileId);
    }

    if (doc.historyFiles) {
      for (const historyFileId of doc.historyFiles) {
        await ctx.storage.delete(historyFileId);
      }
    }

    await ctx.db.delete(args.documentId);
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
