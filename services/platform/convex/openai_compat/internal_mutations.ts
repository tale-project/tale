/**
 * Internal mutations for OpenAI-compatible endpoint.
 *
 * Handles thread creation, RLS validation, and chat start.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { startAgentChat } from '../lib/agent_chat';
import { getOrganizationMember } from '../lib/rls';
import { createChatThread } from '../threads/create_chat_thread';

export const startOpenAIChat = internalMutation({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    message: v.string(),
    threadId: v.optional(v.string()),
    enableStreaming: v.optional(v.boolean()),
    agentConfig: v.any(),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    // RLS: verify user is an active member of the organization
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.userEmail,
      name: args.userName,
    });

    const threadId =
      args.threadId ??
      (await createChatThread(ctx, args.userId, undefined, 'general'));

    const result = await startAgentChat({
      ctx,
      agentType: 'custom',
      threadId,
      organizationId: args.organizationId,
      message: args.message,
      agentConfig: args.agentConfig,
      model: args.agentConfig.model ?? 'default',
      provider: args.agentConfig.provider,
      agentSlug: args.agentSlug,
      debugTag: `[${args.agentSlug}:openai]`,
      enableStreaming: args.enableStreaming ?? true,
    });

    return { threadId, streamId: result.streamId };
  },
});
