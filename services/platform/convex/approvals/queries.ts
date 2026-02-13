import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import * as ApprovalsHelpers from './helpers';
import { listApprovalsPaginated as listApprovalsPaginatedHelper } from './list_approvals_paginated';
import {
  approvalItemValidator,
  approvalStatusValidator,
  approvalResourceTypeValidator,
} from './validators';

export const listApprovalsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(approvalStatusValidator),
    resourceType: v.optional(approvalResourceTypeValidator),
    excludeStatus: v.optional(approvalStatusValidator),
  },
  handler: async (ctx, args) => {
    const emptyResult = { page: [], isDone: true, continueCursor: '' };
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return emptyResult;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return emptyResult;
    }

    return await listApprovalsPaginatedHelper(ctx, args);
  },
});

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
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (approval.resourceType !== 'integration_operation') {
        continue;
      }
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
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (approval.resourceType !== 'workflow_creation') {
        continue;
      }
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
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (approval.resourceType !== 'human_input_request') {
        continue;
      }
      if (args.messageId && approval.messageId !== args.messageId) {
        continue;
      }
      approvals.push(approval);
    }

    return approvals;
  },
});
