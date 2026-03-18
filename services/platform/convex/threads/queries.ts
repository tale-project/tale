import type { StreamId } from '@convex-dev/persistent-text-streaming';

import { listMessages } from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { getThreadMessagesStreaming as getThreadMessagesStreamingHelper } from './get_thread_messages_streaming';
import { listThreads as listThreadsHelper } from './list_threads';

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

export const isThreadGenerating = query({
  args: { threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return false;

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (metadata?.generationStatus !== 'generating' || !metadata.streamId) {
      return false;
    }

    // Verify the persistent stream is still active.
    // Self-heals if action crashed and clearGenerationStatus never ran —
    // the persistent stream expires after 20 min, so getStreamStatus
    // returns 'timeout'/'done'/'error' and we return false.
    try {
      const status = await ctx.runQuery(
        components.persistentTextStreaming.lib.getStreamStatus,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex component Id type
        { streamId: metadata.streamId as StreamId },
      );
      if (status !== 'streaming' && status !== 'pending') return false;
    } catch {
      return false;
    }

    // Zombie detection: if latest assistant has terminal status, the generation
    // completed but clearGenerationStatus hasn't run yet (or crashed).
    const messages = await listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: { numItems: 3, cursor: null },
      excludeToolMessages: true,
    });
    const latestAssistant = messages.page.find(
      (m) => m.message?.role === 'assistant',
    );
    if (
      latestAssistant?.status === 'failed' ||
      latestAssistant?.status === 'success'
    ) {
      return false;
    }

    return true;
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
