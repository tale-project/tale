import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';

export const getByStorageIds = query({
  args: {
    storageIds: v.array(v.id('_storage')),
  },
  returns: v.array(
    v.object({
      storageId: v.id('_storage'),
      documentId: v.optional(v.id('documents')),
      fileName: v.string(),
      contentType: v.string(),
      size: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const results = await Promise.all(
      args.storageIds.slice(0, 20).map(async (storageId) => {
        const meta = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
          .first();
        if (!meta) return null;
        return {
          storageId: meta.storageId,
          documentId: meta.documentId,
          fileName: meta.fileName,
          contentType: meta.contentType,
          size: meta.size,
        };
      }),
    );

    return results.filter((r) => r !== null);
  },
});
