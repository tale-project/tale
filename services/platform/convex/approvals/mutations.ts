/**
 * Approvals Mutations
 *
 * Internal and public mutations for approval operations.
 */

import { v } from 'convex/values';
import { internalMutation, mutation } from '../_generated/server';
import * as ApprovalsHelpers from './helpers';
import { authComponent } from '../auth';
import { approvalResourceTypeValidator, approvalPriorityValidator, approvalStatusValidator } from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const createApproval = internalMutation({
  args: {
    organizationId: v.string(),
    resourceType: approvalResourceTypeValidator,
    resourceId: v.string(),
    priority: approvalPriorityValidator,
    requestedBy: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    description: v.optional(v.string()),
    wfExecutionId: v.optional(v.id('wfExecutions')),
    stepSlug: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await ApprovalsHelpers.createApproval(ctx, args);
  },
});

export const linkApprovalsToMessage = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ApprovalsHelpers.linkApprovalsToMessage(ctx, args);
  },
});

// =============================================================================
// PUBLIC MUTATIONS (for frontend via api.approvals.mutations.*)
// =============================================================================

export const updateApprovalStatusPublic = mutation({
  args: {
    approvalId: v.id('approvals'),
    status: approvalStatusValidator,
    comments: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await ApprovalsHelpers.updateApprovalStatus(ctx, {
      approvalId: args.approvalId,
      status: args.status,
      approvedBy: String(authUser._id),
      comments: args.comments,
    });

    return null;
  },
});

export const removeRecommendedProduct = mutation({
  args: {
    approvalId: v.id('approvals'),
    productId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await ApprovalsHelpers.removeRecommendedProduct(ctx, {
      approvalId: args.approvalId,
      productId: args.productId,
    });

    return null;
  },
});
