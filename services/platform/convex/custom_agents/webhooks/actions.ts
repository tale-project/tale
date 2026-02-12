import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';

import { api } from '../../_generated/api';
import { action } from '../../_generated/server';

export const createWebhook = action({
  args: {
    organizationId: v.string(),
    customAgentId: v.id('customAgents'),
  },
  returns: v.object({
    webhookId: v.id('customAgentWebhooks'),
    token: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ webhookId: Id<'customAgentWebhooks'>; token: string }> => {
    return await ctx.runMutation(
      api.custom_agents.webhooks.mutations.createWebhook,
      args,
    );
  },
});
