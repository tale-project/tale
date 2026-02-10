/**
 * Chat with a custom agent.
 *
 * Loads the ACTIVE PUBLISHED version of a custom agent, converts it to
 * SerializableAgentConfig, and delegates to the existing startAgentChat pipeline.
 * Only published agents can be used for chat.
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

    // Find the active published version by rootVersionId
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

    if (
      !activeVersion ||
      activeVersion.organizationId !== args.organizationId
    ) {
      throw new Error(
        'Agent not published. Only published agents can be used in chat.',
      );
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(activeVersion, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const agentConfig = toSerializableConfig(activeVersion);
    const { model, provider } = getDefaultAgentRuntimeConfig();

    const ragTeamIds: string[] = [];
    if (activeVersion.teamId) ragTeamIds.push(activeVersion.teamId);
    if (activeVersion.includeOrgKnowledge)
      ragTeamIds.push(`org_${args.organizationId}`);

    // Custom agents use their own tools (image, pdf, etc.) to process
    // attachments. File IDs are embedded in the message text by
    // startAgentChat's buildMessageWithAttachments — no chat-agent hooks needed.
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
      debugTag: `[CustomAgent:${activeVersion.name}]`,
      enableStreaming: true,
      ragTeamIds,
    });
  },
});
