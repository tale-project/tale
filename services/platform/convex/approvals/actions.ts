/**
 * Approvals Actions
 *
 * Public actions for approval-related operations.
 */

'use node';

import { action } from '../_generated/server';
import { v, type Infer } from 'convex/values';
import { internal } from '../_generated/api';
import { authComponent } from '../auth';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';

type JsonValue = Infer<typeof jsonValueValidator>;

/**
 * Execute an approved integration operation (public action)
 */
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

    return (await ctx.runAction(
      internal.agent_tools.integrations.execute_approved_operation.executeApprovedOperation,
      {
        approvalId: args.approvalId,
        approvedBy: String(authUser._id),
      },
    )) as JsonValue;
  },
});

/**
 * Execute an approved workflow creation (public action)
 */
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

    return (await ctx.runAction(
      internal.agent_tools.workflows.execute_approved_workflow_creation.executeApprovedWorkflowCreation,
      {
        approvalId: args.approvalId,
        approvedBy: String(authUser._id),
      },
    )) as JsonValue;
  },
});
