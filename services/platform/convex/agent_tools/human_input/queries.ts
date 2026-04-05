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
    const threadId = approval.threadId;
    if (!threadId) throw new Error('Approval has no threadId');

    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();

    return {
      threadId,
      organizationId: approval.organizationId,
      agentSlug: threadMeta?.agentSlug,
    };
  },
});
