import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import { startAgentChat } from '../../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { createChatThread } from '../../threads/create_chat_thread';
import { createCustomAgentHookHandles, toSerializableConfig } from '../config';

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
    for await (const v of activeVersionQuery) {
      activeVersion = v;
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

    const ragTeamIds: string[] = [];
    if (activeVersion.teamId) ragTeamIds.push(activeVersion.teamId);
    if (activeVersion.includeOrgKnowledge)
      ragTeamIds.push(`org_${args.organizationId}`);

    const hooks = await createCustomAgentHookHandles(
      ctx,
      activeVersion.filePreprocessingEnabled,
    );

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
      debugTag: `[CustomAgent:webhook:${activeVersion.name}]`,
      enableStreaming: true,
      ragTeamIds,
      hooks,
    });

    return { threadId, streamId: result.streamId };
  },
});
