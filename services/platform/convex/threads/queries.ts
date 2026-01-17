/**
 * Threads Queries
 *
 * Public queries for thread operations.
 * These queries are used by the frontend via api.queries.threads.*
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { listThreads } from './list_threads';
import { getThreadMessagesStreaming } from './get_thread_messages_streaming';
import { threadListItemValidator, threadStatusValidator } from './validators';

/**
 * List all active threads for the current user.
 */
export const listThreadsQuery = query({
  args: {
    search: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      title: v.optional(v.string()),
      status: threadStatusValidator,
      userId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    return await listThreads(ctx, {
      userId: authUser.userId,
      search: args.search,
    });
  },
});

// Re-export with the name the frontend expects
export { listThreadsQuery as listThreads };

/**
 * Get messages for a thread with streaming support.
 */
export const getThreadMessagesStreamingQuery = query({
  args: {
    threadId: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
    streamArgs: v.optional(
      v.union(
        v.object({
          kind: v.literal('list'),
          startOrder: v.optional(v.number()),
        }),
        v.object({
          kind: v.literal('deltas'),
          cursors: v.array(
            v.object({
              streamId: v.string(),
              cursor: v.number(),
            }),
          ),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
        streams: { value: null },
      };
    }

    return await getThreadMessagesStreaming(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      streamArgs: args.streamArgs,
    });
  },
});

// Re-export with the name the frontend expects
export { getThreadMessagesStreamingQuery as getThreadMessagesStreaming };
