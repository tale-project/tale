import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import * as ApprovalsHelpers from './helpers';
import {
  approvalItemValidator,
  approvalStatusValidator,
  approvalResourceTypeValidator,
} from './validators';

export const listApprovalsByOrganization = query({
  args: {
    organizationId: v.string(),
    status: v.optional(approvalStatusValidator),
    resourceType: v.optional(
      v.union(
        approvalResourceTypeValidator,
        v.array(approvalResourceTypeValidator),
      ),
    ),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return [];
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return [];
    }

    return await ApprovalsHelpers.listApprovalsByOrganization(ctx, args);
  },
});

export const getPendingIntegrationApprovalsForThread = query({
  args: {
    threadId: v.string(),
    messageId: v.optional(v.string()),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
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

export const getWorkflowCreationApprovalsForThread = query({
  args: {
    threadId: v.string(),
    messageId: v.optional(v.string()),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
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

export const getHumanInputRequestsForThread = query({
  args: {
    threadId: v.string(),
    messageId: v.optional(v.string()),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
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
          .eq('resourceType', 'human_input_request'),
      )) {
      if (args.messageId && approval.messageId !== args.messageId) {
        continue;
      }
      approvals.push(approval);
    }

    return approvals;
  },
});
