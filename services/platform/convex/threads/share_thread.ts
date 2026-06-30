import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

export const shareThread = mutation({
  args: {
    threadId: v.string(),
    organizationId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) {
      throw new ConvexError({
        code: 'THREAD_NOT_FOUND',
        message: 'Thread not found',
      });
    }

    if (metadata.userId !== authUser.userId) {
      throw new ConvexError({
        code: 'NOT_AUTHORIZED',
        message: 'Not authorized to share this thread',
      });
    }

    if (metadata.status === 'archived') {
      throw new ConvexError({
        code: 'THREAD_ARCHIVED',
        message: 'Cannot share an archived thread',
      });
    }

    if (metadata.arenaGroupId) {
      throw new ConvexError({
        code: 'CANNOT_SHARE_ARENA_THREAD',
        message: 'Cannot share arena mode threads',
      });
    }

    if (metadata.isBranch) {
      throw new ConvexError({
        code: 'CANNOT_SHARE_BRANCH_THREAD',
        message: 'Cannot share branch threads',
      });
    }

    if (metadata.isShared && metadata.shareToken) {
      return metadata.shareToken;
    }

    const shareToken = crypto.randomUUID();

    await ctx.db.patch(metadata._id, {
      shareToken,
      isShared: true,
      sharedAt: Date.now(),
      sharedBy: authUser.userId,
      // Auto-disable personalization while the thread is shared:
      // future turns by the owner won't inject the owner's memories or
      // customInstructions into replies that share-link viewers can see.
      // Owner can opt back in manually after unsharing.
      disablePersonalization: true,
      // Store organizationId if provided and not already set
      ...(args.organizationId &&
        !metadata.organizationId && {
          organizationId: args.organizationId,
        }),
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) {
      throw new ConvexError({
        code: 'THREAD_NOT_FOUND',
        message: 'Thread not found',
      });
    }

    if (metadata.userId !== authUser.userId) {
      throw new ConvexError({
        code: 'NOT_AUTHORIZED',
        message: 'Not authorized to unshare this thread',
      });
    }

    if (metadata.status === 'archived') {
      throw new ConvexError({
        code: 'THREAD_ARCHIVED',
        message: 'Cannot unshare an archived thread',
      });
    }

    await ctx.db.patch(metadata._id, {
      shareToken: undefined,
      isShared: false,
      sharedAt: undefined,
      sharedBy: undefined,
      // Mirror of share-time auto-disable: clear the field so the thread
      // returns to default (personalization controlled by org/user prefs).
      disablePersonalization: undefined,
    });

    return null;
  },
});
