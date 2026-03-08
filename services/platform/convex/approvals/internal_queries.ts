import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { ApprovalItem } from './types';

import { internalQuery } from '../_generated/server';
import { getOrganizationMember } from '../lib/rls';
import * as ApprovalsHelpers from './helpers';
import { approvalItemValidator } from './validators';

export const getApprovalById = internalQuery({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.union(approvalItemValidator, v.null()),
  handler: async (ctx, args): Promise<ApprovalItem | null> => {
    return await ApprovalsHelpers.getApproval(ctx, args.approvalId);
  },
});

export const verifyOrganizationMembership = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.email,
      name: args.name,
    });
  },
});

export const getApprovalsForThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args): Promise<Doc<'approvals'>[]> => {
    const approvals: Doc<'approvals'>[] = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      approvals.push(approval);
    }
    return approvals;
  },
});
