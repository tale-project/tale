import { mutation, internalMutation } from '../../_generated/server';
import { v } from 'convex/values';

export const createSchedule = mutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    cronExpression: v.string(),
    timezone: v.string(),
    createdBy: v.string(),
  },
  returns: v.id('wfSchedules'),
  handler: async (ctx, args) => {
    const rootDef = await ctx.db.get(args.workflowRootId);
    if (!rootDef) throw new Error('Workflow not found');
    if (rootDef.organizationId !== args.organizationId) {
      throw new Error('Workflow does not belong to this organization');
    }

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

export const updateSchedule = mutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    cronExpression: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    const updates: Record<string, string> = {};
    if (args.cronExpression !== undefined) {
      updates.cronExpression = args.cronExpression;
    }
    if (args.timezone !== undefined) {
      updates.timezone = args.timezone;
    }

    await ctx.db.patch(args.scheduleId, updates);
    return null;
  },
});

export const toggleSchedule = mutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    await ctx.db.patch(args.scheduleId, { isActive: args.isActive });
    return null;
  },
});

export const deleteSchedule = mutation({
  args: { scheduleId: v.id('wfSchedules') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    await ctx.db.delete(args.scheduleId);
    return null;
  },
});

export const updateLastTriggered = internalMutation({
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
