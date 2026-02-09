import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import * as ApprovalsHelpers from './helpers';
import { approvalItemValidator } from './validators';

export const getApprovalById = internalQuery({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.union(approvalItemValidator, v.null()),
  handler: async (ctx, args) => {
    return await ApprovalsHelpers.getApproval(ctx, args.approvalId);
  },
});

export const getApprovalsForThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const approvals = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      approvals.push(approval);
    }
    return approvals;
  },
});
