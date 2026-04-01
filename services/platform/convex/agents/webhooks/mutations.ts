import { v } from 'convex/values';

import { mutation } from '../../_generated/server';
import { validateAgentName } from '../../agents/file_utils';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';
import { generateToken } from '../../workflows/triggers/helpers/crypto';

export const createWebhook = mutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  returns: v.object({
    webhookId: v.id('agentWebhooks'),
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

    if (!validateAgentName(args.agentSlug)) {
      throw new Error(`Invalid agent slug: ${args.agentSlug}`);
    }

    const token = generateToken();

    const webhookId = await ctx.db.insert('agentWebhooks', {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
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
    webhookId: v.id('agentWebhooks'),
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
  args: { webhookId: v.id('agentWebhooks') },
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
