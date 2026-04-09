/**
 * Internal mutations for OpenAI-compatible endpoint.
 *
 * Handles thread creation, RLS validation, chat start, and tool message saving.
 */

import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
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
    generationParams: v.optional(v.any()),
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
      generationParams: args.generationParams,
    });

    return { threadId, streamId: result.streamId };
  },
});

/**
 * Create a thread and save a user message for tool-calling mode.
 * Returns threadId for use in direct streamText calls.
 */
export const createThreadAndSaveMessage = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    threadId: v.optional(v.string()),
    message: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.userEmail,
      name: args.userName,
    });

    const threadId =
      args.threadId ??
      (await createChatThread(ctx, args.userId, undefined, 'general'));

    await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'user', content: args.message },
    });

    return threadId;
  },
});

/**
 * Save tool result messages to a thread for tool-calling continuation.
 */
export const saveToolMessages = internalMutation({
  args: {
    threadId: v.string(),
    messages: v.array(
      v.object({
        role: v.string(),
        content: v.any(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const msg of args.messages) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Tool messages are dynamically constructed from OpenAI format; the SaveMessageArgs type requires exact role literals that can't be statically inferred from the generic validator
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: msg,
      } as unknown as Parameters<typeof saveMessage>[2]);
    }
    return null;
  },
});
