import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import { startAgentChat } from '../../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { createChatThread } from '../../threads/create_chat_thread';
import { toSerializableConfig } from '../config';

export const updateWebhookLastTriggered = internalMutation({
  args: {
    webhookId: v.id('customAgentWebhooks'),
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

export const chatViaWebhook = internalMutation({
  args: {
    customAgentId: v.id('customAgents'),
    organizationId: v.string(),
    webhookId: v.id('customAgentWebhooks'),
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
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    const activeVersionQuery = ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', args.customAgentId).eq('status', 'active'),
      );

    let activeVersion = null;
    for await (const version of activeVersionQuery) {
      activeVersion = version;
      break;
    }

    if (!activeVersion) {
      throw new Error('Agent not published or not found');
    }

    const userId = `webhook:${args.webhookId}`;

    const threadId =
      args.threadId ??
      (await createChatThread(ctx, userId, undefined, 'general'));

    const agentConfig = toSerializableConfig(activeVersion);
    const { model, provider } = getDefaultAgentRuntimeConfig();

    const result = await startAgentChat({
      ctx,
      agentType: 'custom',
      threadId,
      organizationId: args.organizationId,
      message: args.message,
      attachments: args.attachments,
      agentConfig,
      model: agentConfig.model ?? model,
      provider,
      debugTag: `[${activeVersion.name}:v${activeVersion.versionNumber}:webhook]`,
      enableStreaming: args.enableStreaming ?? true,
      customAgentId: args.customAgentId,
    });

    return { threadId, streamId: result.streamId };
  },
});
