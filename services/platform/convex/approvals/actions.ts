'use node';

import { v, type Infer } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { ActionCtx, action } from '../_generated/server';
import { authComponent } from '../auth';

type JsonValue = Infer<typeof jsonValueValidator>;
type AuthUser = NonNullable<
  Awaited<ReturnType<typeof authComponent.getAuthUser>>
>;

async function verifyApprovalAccess(
  ctx: ActionCtx,
  approvalId: Id<'approvals'>,
  authUser: AuthUser,
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
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name ?? '',
    },
  );
}

export const executeApprovedIntegrationOperation = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.integrations.internal_actions
        .executeApprovedOperation,
      {
        approvalId: args.approvalId,
        approvedBy: String(authUser._id),
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.workflows.internal_actions
        .executeApprovedWorkflowRun,
      {
        approvalId: args.approvalId,
        approvedBy: String(authUser._id),
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.workflows.internal_actions
        .executeApprovedWorkflowCreation,
      {
        approvalId: args.approvalId,
        approvedBy: String(authUser._id),
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    return await ctx.runAction(
      internal.agent_tools.workflows.internal_actions
        .executeApprovedWorkflowUpdate,
      {
        approvalId: args.approvalId,
        approvedBy: String(authUser._id),
      },
    );
  },
});
