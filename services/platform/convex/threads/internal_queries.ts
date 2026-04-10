import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getThreadMessages as getThreadMessagesHelper } from './get_thread_messages';
import { listThreads as listThreadsHelper } from './list_threads';

export const getThreadMetadata = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
  },
});

// ---------------------------------------------------------------------------
// REST API helpers
// ---------------------------------------------------------------------------

export const listThreadsInternal = internalQuery({
  args: {
    userId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listThreadsHelper(ctx, {
      userId: args.userId,
      paginationOpts: args.paginationOpts,
    });
  },
});

export const listArchivedThreadsInternal = internalQuery({
  args: {
    userId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('threadMetadata')
      .withIndex('by_userId_chatType_status_updated', (q) =>
        q
          .eq('userId', args.userId)
          .eq('chatType', 'general')
          .eq('status', 'archived'),
      )
      .order('desc')
      .paginate(args.paginationOpts);

    return {
      page: result.page
        .filter((row) => !row.isBranch)
        .map((row) => ({
          _id: row.threadId,
          _creationTime: row.updatedAt ?? row.createdAt,
          title: row.title,
          status: row.status,
          userId: row.userId,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getThreadMessagesInternal = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getThreadMessagesHelper(ctx, args.threadId);
  },
});
