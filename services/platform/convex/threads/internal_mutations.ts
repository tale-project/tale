import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { getOrCreateSubThread } from './get_or_create_sub_thread';
import { subAgentTypeValidator } from './validators';

export const getOrCreateSubThreadAtomic = internalMutation({
  args: {
    parentThreadId: v.string(),
    subAgentType: subAgentTypeValidator,
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

export const cleanupOrphanedSubThreads = internalMutation({
  args: {
    parentThreadId: v.string(),
    subThreadIds: v.array(v.string()),
  },
  returns: v.object({ archivedCount: v.number() }),
  handler: async (ctx, args) => {
    let archivedCount = 0;

    for (const subThreadId of args.subThreadIds) {
      const subThread = await ctx.runQuery(components.agent.threads.getThread, {
        threadId: subThreadId,
      });

      if (subThread?.status === 'active') {
        await ctx.runMutation(components.agent.threads.updateThread, {
          threadId: subThreadId,
          patch: { status: 'archived' },
        });
        archivedCount++;
      }
    }

    console.log(
      `[cleanupOrphanedSubThreads] Archived ${archivedCount} sub-threads for parent ${args.parentThreadId}`,
    );

    return { archivedCount };
  },
});
