import { internalMutation } from '../../_generated/server';
import { v } from 'convex/values';

export const updateScheduleLastTriggered = internalMutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    lastTriggeredAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.scheduleId, {
      lastTriggeredAt: args.lastTriggeredAt,
    });
    return null;
  },
});

export const updateWebhookLastTriggered = internalMutation({
  args: {
    webhookId: v.id('wfWebhooks'),
    lastTriggeredAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.webhookId, {
      lastTriggeredAt: args.lastTriggeredAt,
    });
    return null;
  },
});

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
