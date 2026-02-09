import { v } from 'convex/values';

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
