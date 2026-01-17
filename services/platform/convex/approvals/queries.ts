/**
 * Approvals Queries
 *
 * Internal queries for approval operations.
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import * as ApprovalsHelpers from './helpers';

export const getApprovalById = internalQuery({
  args: {
    approvalId: v.id('approvals'),
  },
  handler: async (ctx, args) => {
    return await ApprovalsHelpers.getApproval(ctx, args.approvalId);
  },
});

export const getApprovalInternal = internalQuery({
  args: {
    approvalId: v.id('approvals'),
  },
  handler: async (ctx, args) => {
    return await ApprovalsHelpers.getApproval(ctx, args.approvalId);
  },
});
