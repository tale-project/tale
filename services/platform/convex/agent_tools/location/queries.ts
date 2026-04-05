import { v } from 'convex/values';

import { internalQuery } from '../../_generated/server';

export const getApprovalContext = internalQuery({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.object({
    threadId: v.string(),
    organizationId: v.string(),
    agentSlug: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (!approval.threadId) throw new Error('Approval has no threadId');

    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', approval.threadId!))
      .first();

    return {
      threadId: approval.threadId,
      organizationId: approval.organizationId,
      agentSlug: threadMeta?.agentSlug,
    };
  },
});
