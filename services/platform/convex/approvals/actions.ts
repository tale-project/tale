'use node';

import { v, type Infer } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';

type JsonValue = Infer<typeof jsonValueValidator>;

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

export const removeRecommendedProduct = action({
  args: {
    approvalId: v.id('approvals'),
    productId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(
      api.approvals.mutations.removeRecommendedProduct,
      args,
    );
  },
});
