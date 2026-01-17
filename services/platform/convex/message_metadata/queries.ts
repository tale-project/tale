/**
 * Message Metadata Queries
 *
 * Public queries for fetching message metadata (token usage, model info, etc.).
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';

export const getMessageMetadata = query({
  args: {
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const metadata = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();

    return metadata;
  },
});
