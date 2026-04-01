/**
 * Internal mutation for starting agent chat.
 *
 * Called by the unified_chat action after reading agent config from filesystem.
 * This mutation handles the transactional parts: stream creation, message saving,
 * and scheduling the agent generation action.
 */

import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { startAgentChat } from '../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../lib/agent_runtime_config';
import { getOrganizationMember } from '../lib/rls';

export const startChat = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userName: v.string(),
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
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
    agentConfig: v.any(),
    agentSlug: v.string(),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.userEmail,
      name: args.userName,
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args.threadId,
    });
    if (!thread || thread.userId !== args.userId) {
      throw new Error('Thread not found');
    }

    const { model, provider } = getDefaultAgentRuntimeConfig();

    return startAgentChat({
      ctx,
      agentType: 'custom',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      additionalContext: args.additionalContext,
      userContext: args.userContext,
      agentConfig: args.agentConfig,
      model: args.agentConfig.model ?? model,
      provider,
      agentSlug: args.agentSlug,
      debugTag: `[${args.agentSlug}]`,
      enableStreaming: true,
    });
  },
});
