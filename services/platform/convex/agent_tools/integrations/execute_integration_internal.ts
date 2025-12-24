/**
 * Internal Action: Execute Integration
 *
 * Wrapper to call the integration action from agent tools.
 * This bridges the gap between the workflow action registry and Convex agent tools.
 */

import { internalAction } from '../../_generated/server';
import { v } from 'convex/values';
import { integrationAction } from '../../workflow/actions/integration/integration_action';

/**
 * Execute an integration operation (internal action callable by agent tools)
 */
export const executeIntegrationInternal = internalAction({
  args: {
    organizationId: v.string(),
    integrationName: v.string(),
    operation: v.string(),
    params: v.optional(v.any()),
    // Skip approval check - used when executing an already approved operation
    skipApprovalCheck: v.optional(v.boolean()),
    // Thread ID for linking approvals to chat
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { organizationId, integrationName, operation, params, skipApprovalCheck, threadId } = args;

    // Call the integration action's execute method
    const result = await integrationAction.execute(
      ctx,
      {
        name: integrationName,
        operation,
        params: params || {},
        skipApprovalCheck: skipApprovalCheck || false,
        threadId,
      },
      {
        organizationId,
      },
    );

    return result;
  },
});
