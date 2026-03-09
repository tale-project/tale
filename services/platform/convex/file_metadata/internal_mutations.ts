import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

export const saveFileMetadata = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.size,
      });
      return existing._id;
    }

    return await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
    });
  },
});
