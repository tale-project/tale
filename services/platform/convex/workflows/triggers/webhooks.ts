import { mutation, internalMutation, internalQuery } from '../../_generated/server';
import { v } from 'convex/values';
import {
  generateToken,
  generateWebhookSecret,
  hashSecret,
} from './helpers/crypto';

export const createWebhook = mutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    createdBy: v.string(),
  },
  returns: v.object({
    webhookId: v.id('wfWebhooks'),
    token: v.string(),
    secret: v.string(),
  }),
  handler: async (ctx, args) => {
    const rootDef = await ctx.db.get(args.workflowRootId);
    if (!rootDef) throw new Error('Workflow not found');
    if (rootDef.organizationId !== args.organizationId) {
      throw new Error('Workflow does not belong to this organization');
    }

    const token = generateToken();
    const secret = generateWebhookSecret();
    const secretHashed = await hashSecret(secret);

    const webhookId = await ctx.db.insert('wfWebhooks', {
      organizationId: args.organizationId,
      workflowRootId: args.workflowRootId,
      token,
      secretHash: secretHashed,
      isActive: true,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });

    return { webhookId, token, secret };
  },
});

export const regenerateSecret = mutation({
  args: { webhookId: v.id('wfWebhooks') },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, args) => {
    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) throw new Error('Webhook not found');

    const secret = generateWebhookSecret();
    const secretHashed = await hashSecret(secret);

    await ctx.db.patch(args.webhookId, { secretHash: secretHashed });
    return { secret };
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

export const getWebhookByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfWebhooks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
  },
});

export const updateLastTriggered = internalMutation({
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
