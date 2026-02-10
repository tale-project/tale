import { v } from 'convex/values';

import { mutation } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';
import { generateToken } from '../../workflows/triggers/helpers/crypto';

export const createWebhook = mutation({
  args: {
    organizationId: v.string(),
    customAgentId: v.id('customAgents'),
  },
  returns: v.object({
    webhookId: v.id('customAgentWebhooks'),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent) throw new Error('Agent not found');
    if (agent.organizationId !== args.organizationId) {
      throw new Error('Agent does not belong to this organization');
    }

    const token = generateToken();

    const webhookId = await ctx.db.insert('customAgentWebhooks', {
      organizationId: args.organizationId,
      customAgentId: args.customAgentId,
      token,
      isActive: true,
      createdAt: Date.now(),
      createdBy: authUser.email ?? String(authUser._id),
    });

    return { webhookId, token };
  },
});

export const toggleWebhook = mutation({
  args: {
    webhookId: v.id('customAgentWebhooks'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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

export const deleteWebhook = mutation({
  args: { webhookId: v.id('customAgentWebhooks') },
  returns: v.null(),
  handler: async (ctx, args) => {
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
