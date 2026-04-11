import { v } from 'convex/values';

import { query } from '../_generated/server';
import { messageMetadataValidator } from '../streaming/validators';

export const getMessageMetadata = query({
  args: {
    messageId: v.string(),
    threadId: v.optional(v.string()),
  },
  returns: v.union(messageMetadataValidator, v.null()),
  handler: async (ctx, args) => {
    const direct = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();
    if (direct) return direct;

    // In error scenarios, the metadata is saved with the failed message's
    // ID which differs from the UIMessage id (first message in group).
    // Fall back to the most recent metadata entry for this thread.
    const { threadId } = args;
    if (threadId) {
      return ctx.db
        .query('messageMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
        .order('desc')
        .first();
    }

    return null;
  },
});
