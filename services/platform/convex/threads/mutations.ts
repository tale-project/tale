/**
 * Threads Mutations
 *
 * Internal mutations for thread operations.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { getOrCreateSubThread } from './get_or_create_sub_thread';

export const getOrCreateSubThreadAtomic = internalMutation({
  args: {
    parentThreadId: v.string(),
    subAgentType: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await getOrCreateSubThread(
      ctx,
      args.parentThreadId,
      args.subAgentType as any,
      args.userId,
    );
  },
});
