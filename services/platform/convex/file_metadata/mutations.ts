import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';

export const saveFileMetadata = mutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    documentId: v.optional(v.id('documents')),
  },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    if (existing) {
      const patchData: Record<string, unknown> = {
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.size,
      };
      if (args.documentId !== undefined) {
        patchData.documentId = args.documentId;
      }
      await ctx.db.patch(existing._id, patchData);
      return existing._id;
    }

    return await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      ...(args.documentId !== undefined && { documentId: args.documentId }),
    });
  },
});
