/**
 * Approvals Queries
 *
 * Internal and public queries for approval operations.
 */

import { v } from 'convex/values';
import { internalQuery, query } from '../_generated/server';
import * as ApprovalsHelpers from './helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import {
  approvalItemValidator,
  approvalStatusValidator,
  approvalResourceTypeValidator,
} from './validators';

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

// =============================================================================
// PUBLIC QUERIES (for frontend via api.approvals.queries.*)
// =============================================================================

/**
 * Get approvals by organization with optional filters.
 */
export const getApprovalsByOrganization = query({
  args: {
    organizationId: v.string(),
    status: v.optional(approvalStatusValidator),
    resourceType: v.optional(
      v.union(approvalResourceTypeValidator, v.array(approvalResourceTypeValidator)),
    ),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser._id,
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return [];
    }

    return await ApprovalsHelpers.listApprovalsByOrganization(ctx, args);
  },
});

/**
 * Get pending integration approvals for a specific thread.
 */
export const getPendingIntegrationApprovalsForThread = query({
  args: {
    threadId: v.string(),
    messageId: v.optional(v.string()),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    const approvals = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', args.threadId)
          .eq('status', 'pending')
          .eq('resourceType', 'integration_operation'),
      )) {
      if (args.messageId && approval.messageId !== args.messageId) {
        continue;
      }
      approvals.push(approval);
    }

    return approvals;
  },
});

/**
 * Get workflow creation approvals for a specific thread.
 */
export const getWorkflowCreationApprovalsForThread = query({
  args: {
    threadId: v.string(),
    messageId: v.optional(v.string()),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    const approvals = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', args.threadId)
          .eq('status', 'pending')
          .eq('resourceType', 'workflow_creation'),
      )) {
      if (args.messageId && approval.messageId !== args.messageId) {
        continue;
      }
      approvals.push(approval);
    }

    return approvals;
  },
});
