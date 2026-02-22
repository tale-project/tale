import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { getThreadMessagesStreaming as getThreadMessagesStreamingHelper } from './get_thread_messages_streaming';
import { listThreads as listThreadsHelper } from './list_threads';

// Defensive: paginationOpts is optional because the Convex client occasionally
// replays subscriptions with empty args ({}) during WebSocket reconnection or
// token refresh. usePaginatedQuery always provides paginationOpts at runtime.
export const listThreads = query({
  args: {
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
      };
    }

    return await listThreadsHelper(ctx, {
      userId: authUser.userId,
      paginationOpts: args.paginationOpts ?? { cursor: null, numItems: 20 },
    });
  },
});

export const getThreadMessagesStreaming = query({
  args: {
    threadId: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
      endCursor: v.optional(v.union(v.string(), v.null())),
      id: v.optional(v.number()),
      maximumRowsRead: v.optional(v.number()),
      maximumBytesRead: v.optional(v.number()),
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
        streams: { value: null },
      };
    }

    return await getThreadMessagesStreamingHelper(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      streamArgs: args.streamArgs,
    });
  },
});
