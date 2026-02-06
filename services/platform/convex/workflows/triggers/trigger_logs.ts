import { internalMutation } from '../../_generated/server';
import { v } from 'convex/values';

export const createTriggerLog = internalMutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    wfDefinitionId: v.id('wfDefinitions'),
    wfExecutionId: v.optional(v.id('wfExecutions')),
    triggerType: v.union(
      v.literal('manual'),
      v.literal('schedule'),
      v.literal('webhook'),
      v.literal('api'),
    ),
    status: v.union(
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('duplicate'),
      v.literal('rate_limited'),
    ),
    idempotencyKey: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.id('wfTriggerLogs'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('wfTriggerLogs', {
      ...args,
      receivedAt: Date.now(),
    });
  },
});
