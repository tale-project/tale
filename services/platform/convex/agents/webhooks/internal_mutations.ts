import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import { startAgentChat } from '../../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { createChatThread } from '../../threads/create_chat_thread';

export const updateWebhookLastTriggered = internalMutation({
  args: {
    webhookId: v.id('agentWebhooks'),
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

export const startWebhookChat = internalMutation({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    webhookId: v.id('agentWebhooks'),
    message: v.string(),
    threadId: v.optional(v.string()),
    enableStreaming: v.optional(v.boolean()),
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
    agentConfig: v.any(),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = `webhook:${args.webhookId}`;

    const threadId =
      args.threadId ??
      (await createChatThread(ctx, userId, undefined, 'general'));

    const { model, provider } = getDefaultAgentRuntimeConfig();

    const result = await startAgentChat({
      ctx,
      agentType: 'custom',
      threadId,
      organizationId: args.organizationId,
      message: args.message,
      attachments: args.attachments,
      agentConfig: args.agentConfig,
      model: args.agentConfig.model ?? model,
      provider,
      agentSlug: args.agentSlug,
      debugTag: `[${args.agentSlug}:webhook]`,
      enableStreaming: args.enableStreaming ?? true,
    });

    return { threadId, streamId: result.streamId };
  },
});
