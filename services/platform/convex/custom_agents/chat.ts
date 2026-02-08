/**
 * Chat with a custom agent.
 *
 * Loads a custom agent config from the database, converts it to
 * SerializableAgentConfig, and delegates to the existing startAgentChat pipeline.
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { startAgentChat } from '../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../lib/agent_runtime_config';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';
import { toSerializableConfig } from './config';

export const chatWithCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    threadId: v.string(),
    organizationId: v.string(),
    message: v.string(),
    maxSteps: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent || !agent.isActive || agent.organizationId !== args.organizationId) {
      throw new Error('Agent not found or inactive');
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(agent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const agentConfig = toSerializableConfig(agent);
    const { model, provider } = getDefaultAgentRuntimeConfig();

    return startAgentChat({
      ctx,
      agentType: 'custom',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig,
      model: agentConfig.model ?? model,
      provider,
      debugTag: `[CustomAgent:${agent.name}]`,
      enableStreaming: true,
    });
  },
});
