import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import { DEFAULT_COUNT_CAP } from '../lib/helpers/count_items_in_org';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { UnauthorizedError } from '../lib/rls/errors';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import * as ApprovalsHelpers from './helpers';
import { listApprovalsPaginated as listApprovalsPaginatedHelper } from './list_approvals_paginated';
import {
  approvalItemValidator,
  approvalStatusValidator,
  approvalResourceTypeValidator,
} from './validators';

export const getApproval = query({
  args: {
    approvalId: v.id('approvals'),
    organizationId: v.string(),
  },
  returns: v.union(approvalItemValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const approval = await ApprovalsHelpers.getApproval(ctx, args.approvalId);
    // Active-org coherence: deny an approval carried over from another org.
    if (
      !approval ||
      !isActiveOrg(approval.organizationId, args.organizationId)
    ) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, approval.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) return null;
      throw error;
    }

    return approval;
  },
});

export const approxCountApprovalsByStatus = query({
  args: {
    organizationId: v.string(),
    status: v.union(v.literal('pending'), v.literal('resolved')),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return 0;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) return 0;
      throw error;
    }

    if (args.status === 'pending') {
      let count = 0;
      for await (const _ of ctx.db
        .query('approvals')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', 'pending'),
        )) {
        count++;
        if (count >= DEFAULT_COUNT_CAP) break;
      }
      return count;
    }

    let count = 0;
    for (const status of ['executing', 'completed', 'rejected'] as const) {
      for await (const _ of ctx.db
        .query('approvals')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        count++;
        if (count >= DEFAULT_COUNT_CAP) break;
      }
      if (count >= DEFAULT_COUNT_CAP) break;
    }
    return count;
  },
});

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
    } catch (error) {
      if (error instanceof UnauthorizedError) return emptyResult;
      throw error;
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
    } catch (error) {
      if (error instanceof UnauthorizedError) return [];
      throw error;
    }

    return await ApprovalsHelpers.listApprovalsByOrganization(ctx, args);
  },
});

export const listActiveApprovalsByOrganization = query({
  args: {
    organizationId: v.string(),
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
    } catch (error) {
      if (error instanceof UnauthorizedError) return [];
      throw error;
    }

    return await ApprovalsHelpers.listActiveApprovalsByOrganization(ctx, args);
  },
});

/**
 * Resolved (completed/rejected) human-input requests for one thread. The
 * active-approvals subscription only carries pending/executing rows, so the
 * chat needs this to render answered request cards inline in the history —
 * including the "edit response" affordance on completed ones. Thread-bounded
 * and index-backed, so it stays cheap on long-lived orgs.
 */
export const listResolvedHumanInputRequestsByThread = query({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return [];
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) return [];
      throw error;
    }

    const approvals = [];
    for (const status of ['completed', 'rejected'] as const) {
      for await (const approval of ctx.db
        .query('approvals')
        .withIndex('by_threadId_status_resourceType', (q) =>
          q
            .eq('threadId', args.threadId)
            .eq('status', status)
            .eq('resourceType', 'human_input_request'),
        )) {
        // Membership was verified against args.organizationId — drop rows
        // from any other org so a guessed threadId can't leak them.
        if (approval.organizationId !== args.organizationId) continue;
        approvals.push(approval);
      }
    }
    return approvals;
  },
});

export const getPendingConnectorApprovalsForThread = query({
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

    // RLS: only members of the thread's org may read its approval rows. A
    // guessed/out-of-tenant threadId resolves to no accessible thread and
    // returns []. Capture the thread's org to cross-check each row below.
    const thread = await canAccessThread(ctx, args.threadId, authUser);
    if (!thread) {
      return [];
    }

    const approvals = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (approval.resourceType !== 'connector_operation') {
        continue;
      }
      if (args.messageId && approval.messageId !== args.messageId) {
        continue;
      }
      // Defence in depth: drop any row whose org diverges from the thread's.
      // Org-less threads (canAccessThread returns no organizationId) have
      // nothing to diverge from, so skip the check rather than drop every row.
      if (
        thread.organizationId &&
        approval.organizationId !== thread.organizationId
      ) {
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

    // RLS: only members of the thread's org may read its approval rows. A
    // guessed/out-of-tenant threadId resolves to no accessible thread and
    // returns []. Capture the thread's org to cross-check each row below.
    const thread = await canAccessThread(ctx, args.threadId, authUser);
    if (!thread) {
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
      // Defence in depth: drop any row whose org diverges from the thread's.
      // Org-less threads (canAccessThread returns no organizationId) have
      // nothing to diverge from, so skip the check rather than drop every row.
      if (
        thread.organizationId &&
        approval.organizationId !== thread.organizationId
      ) {
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

    // RLS: only members of the thread's org may read its approval rows. A
    // guessed/out-of-tenant threadId resolves to no accessible thread and
    // returns []. Capture the thread's org to cross-check each row below.
    const thread = await canAccessThread(ctx, args.threadId, authUser);
    if (!thread) {
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
      // Defence in depth: drop any row whose org diverges from the thread's.
      // Org-less threads (canAccessThread returns no organizationId) have
      // nothing to diverge from, so skip the check rather than drop every row.
      if (
        thread.organizationId &&
        approval.organizationId !== thread.organizationId
      ) {
        continue;
      }
      approvals.push(approval);
    }

    return approvals;
  },
});
