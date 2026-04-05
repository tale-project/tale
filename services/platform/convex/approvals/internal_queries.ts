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

export const listPendingForExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.array(approvalItemValidator),
  handler: async (ctx, args): Promise<ApprovalItem[]> => {
    return await ApprovalsHelpers.listPendingApprovalsForExecution(
      ctx,
      args.executionId,
    );
  },
});

export const listRespondedForExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.array(
    v.object({
      question: v.string(),
      response: v.union(v.string(), v.array(v.string())),
    }),
  ),
  handler: async (ctx, args) => {
    const approvals = await ApprovalsHelpers.listApprovalsForExecution(
      ctx,
      args.executionId,
    );
    const responded: Array<{ question: string; response: string | string[] }> =
      [];
    for (const approval of approvals) {
      if (
        approval.status === 'completed' &&
        approval.resourceType === 'human_input_request' &&
        approval.metadata
      ) {
        const meta =
          typeof approval.metadata === 'object' && approval.metadata !== null
            ? approval.metadata
            : {};
        const question =
          'question' in meta && typeof meta.question === 'string'
            ? meta.question
            : '';
        const responseField = 'response' in meta ? meta.response : undefined;
        const responseRecord =
          typeof responseField === 'object' && responseField !== null
            ? responseField
            : null;
        const responseValue =
          responseRecord && 'value' in responseRecord
            ? responseRecord.value
            : undefined;
        if (question && typeof responseValue === 'string') {
          responded.push({ question, response: responseValue });
        } else if (
          question &&
          Array.isArray(responseValue) &&
          responseValue.every(
            (item): item is string => typeof item === 'string',
          )
        ) {
          responded.push({ question, response: responseValue });
        }
      }
    }
    return responded;
  },
});

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
