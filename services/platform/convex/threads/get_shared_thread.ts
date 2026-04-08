import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getThreadMessages } from './get_thread_messages';

export const getSharedThread = query({
  args: {
    shareToken: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.shareToken))
      .first();

    if (!metadata || !metadata.isShared) {
      return null;
    }

    const { messages } = await getThreadMessages(ctx, metadata.threadId);

    return {
      threadId: metadata.threadId,
      title: metadata.title,
      createdAt: metadata.createdAt,
      sharedBy: metadata.sharedBy,
      messages,
    };
  },
});
