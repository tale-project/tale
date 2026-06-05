'use node';

import { v, type Infer } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { ActionCtx, action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import type { AuthenticatedUser } from '../lib/rls/types';

type JsonValue = Infer<typeof jsonValueValidator>;

async function verifyApprovalAccess(
  ctx: ActionCtx,
  approvalId: Id<'approvals'>,
  authUser: AuthenticatedUser,
) {
  const approval = await ctx.runQuery(
    internal.approvals.internal_queries.getApprovalById,
    { approvalId },
  );
  if (!approval) {
    throw new Error('Approval not found');
  }
  await ctx.runQuery(
    internal.approvals.internal_queries.verifyOrganizationMembership,
    {
      organizationId: approval.organizationId,
      userId: authUser.userId,
      // Pass identity email/name through as-is (optional). `?? ''` would
      // disable getOrganizationMember's email-fallback (empty string is falsy).
      email: authUser.email,
      name: authUser.name,
    },
  );
}

export const executeApprovedIntegrationOperation = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.integrations.internal_actions
        .executeApprovedOperation,
      {
        approvalId: args.approvalId,
        approvedBy: authUser.userId,
      },
    );
  },
});

export const executeApprovedWorkflowRun = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.workflows.internal_actions
        .executeApprovedWorkflowRun,
      {
        approvalId: args.approvalId,
        approvedBy: authUser.userId,
      },
    );
  },
});

export const executeApprovedWorkflowCreation = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.workflows.internal_actions
        .executeApprovedWorkflowCreation,
      {
        approvalId: args.approvalId,
        approvedBy: authUser.userId,
      },
    );
  },
});

export const executeApprovedDocumentWrite = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.documents.internal_actions
        .executeApprovedDocumentWrite,
      {
        approvalId: args.approvalId,
        approvedBy: authUser.userId,
      },
    );
  },
});

export const executeApprovedWorkflowUpdate = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.workflows.internal_actions
        .executeApprovedWorkflowUpdate,
      {
        approvalId: args.approvalId,
        approvedBy: authUser.userId,
      },
    );
  },
});
