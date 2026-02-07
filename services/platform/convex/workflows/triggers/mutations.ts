import { mutation } from '../../_generated/server';
import { v } from 'convex/values';
import { generateToken, generateApiKey, hashSecret } from './helpers/crypto';

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

export const createWebhook = mutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    createdBy: v.string(),
  },
  returns: v.object({
    webhookId: v.id('wfWebhooks'),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    const rootDef = await ctx.db.get(args.workflowRootId);
    if (!rootDef) throw new Error('Workflow not found');
    if (rootDef.organizationId !== args.organizationId) {
      throw new Error('Workflow does not belong to this organization');
    }

    const token = generateToken();

    const webhookId = await ctx.db.insert('wfWebhooks', {
      organizationId: args.organizationId,
      workflowRootId: args.workflowRootId,
      token,
      isActive: true,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });

    return { webhookId, token };
  },
});

export const deleteWebhook = mutation({
  args: { webhookId: v.id('wfWebhooks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) throw new Error('Webhook not found');

    await ctx.db.delete(args.webhookId);
    return null;
  },
});

export const toggleWebhook = mutation({
  args: {
    webhookId: v.id('wfWebhooks'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) throw new Error('Webhook not found');

    await ctx.db.patch(args.webhookId, { isActive: args.isActive });
    return null;
  },
});

export const createApiKey = mutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    name: v.string(),
    expiresAt: v.optional(v.number()),
    createdBy: v.string(),
  },
  returns: v.object({
    keyId: v.id('wfApiKeys'),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    const rootDef = await ctx.db.get(args.workflowRootId);
    if (!rootDef) throw new Error('Workflow not found');
    if (rootDef.organizationId !== args.organizationId) {
      throw new Error('Workflow does not belong to this organization');
    }

    const key = generateApiKey();
    const keyHash = await hashSecret(key);
    const keyPrefix = key.substring(0, 12);

    const keyId = await ctx.db.insert('wfApiKeys', {
      organizationId: args.organizationId,
      workflowRootId: args.workflowRootId,
      name: args.name,
      keyHash,
      keyPrefix,
      isActive: true,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });

    return { keyId, key };
  },
});

export const revokeApiKey = mutation({
  args: { keyId: v.id('wfApiKeys') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    if (!apiKey) throw new Error('API key not found');

    await ctx.db.patch(args.keyId, { isActive: false });
    return null;
  },
});

export const deleteApiKey = mutation({
  args: { keyId: v.id('wfApiKeys') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    if (!apiKey) throw new Error('API key not found');

    await ctx.db.delete(args.keyId);
    return null;
  },
});
