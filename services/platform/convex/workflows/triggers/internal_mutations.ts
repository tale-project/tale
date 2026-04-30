import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import { internalMutation } from '../../_generated/server';
import { jsonRecordValidator } from '../../lib/validators/json';
import { validateWorkflowDependencies } from '../../workflow_engine/helpers/validation/validate_workflow_dependencies';
import { generateToken } from './helpers/crypto';
import { processEventHandler } from './process_event';

const integrationDependencyValidator = v.object({
  name: v.string(),
  operations: v.optional(v.array(v.string())),
  minVersion: v.optional(v.number()),
});

const requiresValidator = v.object({
  integrations: v.optional(v.array(integrationDependencyValidator)),
});

export const updateScheduleLastTriggered = internalMutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    lastTriggeredAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
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
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.webhookId, {
      lastTriggeredAt: args.lastTriggeredAt,
    });
    return null;
  },
});

export const createTriggerLog = internalMutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.optional(v.id('wfDefinitions')),
    workflowSlug: v.optional(v.string()),
    wfDefinitionId: v.optional(v.union(v.id('wfDefinitions'), v.string())),
    wfExecutionId: v.optional(v.id('wfExecutions')),
    triggerType: v.union(
      v.literal('manual'),
      v.literal('schedule'),
      v.literal('webhook'),
      v.literal('api'),
      v.literal('event'),
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
  handler: async (ctx, args): Promise<Id<'wfTriggerLogs'>> => {
    return await ctx.db.insert('wfTriggerLogs', {
      ...args,
      receivedAt: Date.now(),
    });
  },
});

export const provisionSchedule = internalMutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    cronExpression: v.string(),
    timezone: v.string(),
    createdBy: v.string(),
  },
  returns: v.id('wfSchedules'),
  handler: async (ctx, args): Promise<Id<'wfSchedules'>> => {
    return await ctx.db.insert('wfSchedules', {
      organizationId: args.organizationId,
      workflowRootId: args.workflowRootId,
      cronExpression: args.cronExpression,
      timezone: args.timezone,
      isActive: true,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
  },
});

export const provisionEventSubscription = internalMutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    eventType: v.string(),
    eventFilter: v.optional(v.record(v.string(), v.string())),
    createdBy: v.string(),
  },
  returns: v.id('wfEventSubscriptions'),
  handler: async (ctx, args): Promise<Id<'wfEventSubscriptions'>> => {
    return await ctx.db.insert('wfEventSubscriptions', {
      organizationId: args.organizationId,
      workflowRootId: args.workflowRootId,
      eventType: args.eventType,
      eventFilter: args.eventFilter,
      isActive: true,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
  },
});

export const processEvent = internalMutation({
  args: {
    organizationId: v.string(),
    eventType: v.string(),
    eventData: v.optional(v.any()),
  },
  returns: v.null(),
  handler: processEventHandler,
});

// ---------------------------------------------------------------------------
// REST API helpers — CRUD for schedules, webhooks
// ---------------------------------------------------------------------------

export const createScheduleInternal = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    cronExpression: v.string(),
    timezone: v.string(),
    createdBy: v.string(),
    variables: v.optional(jsonRecordValidator),
    requires: v.optional(requiresValidator),
  },
  returns: v.id('wfSchedules'),
  handler: async (ctx, args): Promise<Id<'wfSchedules'>> => {
    if (args.requires) {
      await validateWorkflowDependencies(ctx, {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        requires: args.requires,
      });
    }

    return await ctx.db.insert('wfSchedules', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      cronExpression: args.cronExpression,
      timezone: args.timezone,
      isActive: true,
      createdAt: Date.now(),
      createdBy: args.createdBy,
      variables: args.variables,
    });
  },
});

export const updateScheduleInternal = internalMutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    cronExpression: v.optional(v.string()),
    timezone: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    variables: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { scheduleId, ...patch } = args;
    const updates: Record<string, unknown> = {};
    if (patch.cronExpression !== undefined)
      updates.cronExpression = patch.cronExpression;
    if (patch.timezone !== undefined) updates.timezone = patch.timezone;
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;
    if (patch.variables !== undefined) updates.variables = patch.variables;
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(scheduleId, updates);
    }
    return null;
  },
});

export const deleteScheduleInternal = internalMutation({
  args: { scheduleId: v.id('wfSchedules') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.delete(args.scheduleId);
    return null;
  },
});

export const createWebhookInternal = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    createdBy: v.string(),
  },
  returns: v.object({ _id: v.id('wfWebhooks'), token: v.string() }),
  handler: async (ctx, args) => {
    const token = generateToken();
    const id = await ctx.db.insert('wfWebhooks', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      token,
      isActive: true,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
    return { _id: id, token };
  },
});

export const deleteWebhookInternal = internalMutation({
  args: { webhookId: v.id('wfWebhooks') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.delete(args.webhookId);
    return null;
  },
});

export const cancelExecutionInternal = internalMutation({
  args: { executionId: v.id('wfExecutions') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const execution = await ctx.db.get(args.executionId);
    if (
      execution &&
      (execution.status === 'running' || execution.status === 'pending')
    ) {
      await ctx.db.patch(args.executionId, {
        status: 'failed',
        updatedAt: Date.now(),
        metadata: JSON.stringify({
          error: 'Cancelled via REST API',
          cancelledAt: Date.now(),
        }),
      });
    }
    return null;
  },
});
