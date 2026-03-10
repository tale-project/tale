'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';

export const initializeDefaultWorkflows = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(
      internal.custom_agents.seed_system_defaults.seedSystemDefaultAgents,
      { organizationId: args.organizationId },
    );
  },
});
