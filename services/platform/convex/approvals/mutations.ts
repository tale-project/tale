import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import * as ApprovalsHelpers from './helpers';
import { approvalStatusValidator } from './validators';

export const updateApprovalStatus = mutation({
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

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    await getOrganizationMember(ctx, approval.organizationId);

    const previousStatus = approval.status;

    await ApprovalsHelpers.updateApprovalStatus(ctx, {
      approvalId: args.approvalId,
      status: args.status,
      approvedBy: String(authUser._id),
      comments: args.comments,
    });

    const action =
      args.status === 'executing' ? 'approve_request' : 'reject_request';

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: approval.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          type: 'user',
        },
      },
      action,
      'workflow',
      'approval',
      String(args.approvalId),
      approval.resourceType,
      { status: previousStatus },
      { status: args.status, comments: args.comments },
    );

    // Write system message to thread on rejection so the AI knows it was user-initiated
    if (args.status === 'rejected' && approval.threadId) {
      const reason = args.comments
        ? `Reason: ${args.comments}`
        : 'No reason provided.';
      await saveMessage(ctx, components.agent, {
        threadId: approval.threadId,
        message: {
          role: 'system',
          content: `[APPROVAL_REJECTED]\nThe user manually rejected the ${approval.resourceType.replace(/_/g, ' ')} request.\n${reason}\n\nInstructions:\n- Acknowledge that the user rejected this request\n- Do NOT speculate about technical errors or failures\n- Ask if they would like to try a different approach`,
        },
      });
    }

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

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    await getOrganizationMember(ctx, approval.organizationId);

    await ApprovalsHelpers.removeRecommendedProduct(ctx, {
      approvalId: args.approvalId,
      productId: args.productId,
    });

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: approval.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          type: 'user',
        },
      },
      'remove_recommended_product',
      'workflow',
      'approval',
      String(args.approvalId),
      approval.resourceType,
      undefined,
      undefined,
      { productId: args.productId },
    );

    return null;
  },
});
