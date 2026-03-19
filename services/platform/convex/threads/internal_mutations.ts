import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { cleanupOrphanedSubThreads as cleanupOrphanedSubThreadsHandler } from './cleanup_orphaned_sub_threads';
import { getOrCreateSubThread } from './get_or_create_sub_thread';

export const getOrCreateSubThreadAtomic = internalMutation({
  args: {
    parentThreadId: v.string(),
    subAgentType: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    isNew: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await getOrCreateSubThread(
      ctx,
      args.parentThreadId,
      args.subAgentType,
      args.userId,
    );
  },
});

export const clearGenerationStatus = internalMutation({
  args: { threadId: v.string(), streamId: v.string() },
  handler: async (ctx, args) => {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    // Only clear if the streamId matches — prevents a stale action from
    // clearing a newer generation's 'generating' status.
    if (meta && meta.streamId === args.streamId) {
      await ctx.db.patch(meta._id, {
        generationStatus: 'idle',
        streamId: undefined,
      });
    }
  },
});

export const cleanupOrphanedSubThreads = internalMutation({
  args: {
    parentThreadId: v.string(),
    subThreadIds: v.array(v.string()),
  },
  returns: v.object({ archivedCount: v.number() }),
  handler: async (ctx, args) => {
    return await cleanupOrphanedSubThreadsHandler(
      ctx,
      args.parentThreadId,
      args.subThreadIds,
    );
  },
});
