import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';

import { mutation } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';
import { isValidEventType } from './event_types';
import { generateToken } from './helpers/crypto';

const WORKFLOW_SLUG_REGEX =
  /^(?!.*__)[a-z0-9][a-z0-9_-]*(\/(?!.*__)[a-z0-9][a-z0-9_-]*)?$/;

function validateWorkflowSlug(slug: string): boolean {
  return WORKFLOW_SLUG_REGEX.test(slug) && slug.length <= 128;
}

export const createScheduleBySlug = mutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    cronExpression: v.string(),
    timezone: v.string(),
  },
  returns: v.id('wfSchedules'),
  handler: async (ctx, args): Promise<Id<'wfSchedules'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await ctx.db.insert('wfSchedules', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      cronExpression: args.cronExpression,
      timezone: args.timezone,
      isActive: true,
      createdAt: Date.now(),
      createdBy: authUser.email ?? String(authUser._id),
    });
  },
});

export const toggleScheduleBySlug = mutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    await getOrganizationMember(ctx, schedule.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.patch(args.scheduleId, { isActive: args.isActive });
    return null;
  },
});

export const updateScheduleBySlug = mutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    cronExpression: v.string(),
    timezone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    await getOrganizationMember(ctx, schedule.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.patch(args.scheduleId, {
      cronExpression: args.cronExpression,
      timezone: args.timezone,
    });
    return null;
  },
});

export const deleteScheduleBySlug = mutation({
  args: { scheduleId: v.id('wfSchedules') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    await getOrganizationMember(ctx, schedule.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.delete(args.scheduleId);
    return null;
  },
});

export const createWebhookBySlug = mutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({
    webhookId: v.id('wfWebhooks'),
    token: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ webhookId: Id<'wfWebhooks'>; token: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const token = generateToken();

    const webhookId = await ctx.db.insert('wfWebhooks', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      token,
      isActive: true,
      createdAt: Date.now(),
      createdBy: authUser.email ?? String(authUser._id),
    });

    return { webhookId, token };
  },
});

export const toggleWebhookBySlug = mutation({
  args: {
    webhookId: v.id('wfWebhooks'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) throw new Error('Webhook not found');

    await getOrganizationMember(ctx, webhook.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.patch(args.webhookId, { isActive: args.isActive });
    return null;
  },
});

export const deleteWebhookBySlug = mutation({
  args: { webhookId: v.id('wfWebhooks') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) throw new Error('Webhook not found');

    await getOrganizationMember(ctx, webhook.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.delete(args.webhookId);
    return null;
  },
});

export const createEventSubscriptionBySlug = mutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    eventType: v.string(),
    eventFilter: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.id('wfEventSubscriptions'),
  handler: async (ctx, args): Promise<Id<'wfEventSubscriptions'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    if (!isValidEventType(args.eventType)) {
      throw new Error(`Invalid event type: ${String(args.eventType)}`);
    }

    const existing = await ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('organizationId'), args.organizationId),
          q.eq(q.field('eventType'), args.eventType),
        ),
      )
      .first();

    if (existing) {
      throw new Error(
        `Event subscription for "${args.eventType}" already exists on this workflow`,
      );
    }

    const cleanFilter =
      args.eventFilter && Object.keys(args.eventFilter).length > 0
        ? args.eventFilter
        : undefined;

    const insertData = {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      eventType: args.eventType,
      isActive: true,
      createdAt: Date.now(),
      createdBy: authUser.email ?? String(authUser._id),
      ...(cleanFilter !== undefined && { eventFilter: cleanFilter }),
    };
    return await ctx.db.insert('wfEventSubscriptions', insertData);
  },
});

export const toggleEventSubscriptionBySlug = mutation({
  args: {
    subscriptionId: v.id('wfEventSubscriptions'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error('Event subscription not found');

    await getOrganizationMember(ctx, sub.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.patch(args.subscriptionId, { isActive: args.isActive });
    return null;
  },
});

export const updateEventSubscriptionBySlug = mutation({
  args: {
    subscriptionId: v.id('wfEventSubscriptions'),
    eventFilter: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error('Event subscription not found');

    await getOrganizationMember(ctx, sub.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.patch(args.subscriptionId, {
      eventFilter: args.eventFilter,
    });
    return null;
  },
});

export const deleteEventSubscriptionBySlug = mutation({
  args: { subscriptionId: v.id('wfEventSubscriptions') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error('Event subscription not found');

    await getOrganizationMember(ctx, sub.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await ctx.db.delete(args.subscriptionId);
    return null;
  },
});
