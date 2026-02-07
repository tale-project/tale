import { v } from 'convex/values';
import { query } from '../_generated/server';
import { messageMetadataValidator } from '../streaming/validators';

export const getMessageMetadata = query({
  args: {
    messageId: v.string(),
  },
  returns: v.union(messageMetadataValidator, v.null()),
  handler: async (ctx, args) => {
    return ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();
  },
});
