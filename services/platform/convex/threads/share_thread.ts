import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';

export const shareThread = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) {
      throw new Error('Thread not found');
    }

    if (metadata.userId !== String(authUser._id)) {
      throw new Error('Not authorized to share this thread');
    }

    if (metadata.isShared && metadata.shareToken) {
      return metadata.shareToken;
    }

    const shareToken = crypto.randomUUID();

    await ctx.db.patch(metadata._id, {
      shareToken,
      isShared: true,
      sharedAt: Date.now(),
      sharedBy: String(authUser._id),
    });

    return shareToken;
  },
});

export const unshareThread = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) {
      throw new Error('Thread not found');
    }

    if (metadata.userId !== String(authUser._id)) {
      throw new Error('Not authorized to unshare this thread');
    }

    await ctx.db.patch(metadata._id, {
      shareToken: undefined,
      isShared: false,
      sharedAt: undefined,
      sharedBy: undefined,
    });

    return null;
  },
});
