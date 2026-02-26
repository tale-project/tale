/**
 * Unified Chat Mutation
 *
 * Single entry point for chatting with any agent (system default or custom).
 * The caller must always provide an explicit agentId (the root version ID).
 * Default agent resolution happens on the frontend via useEffectiveAgent.
 */

import { v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { startAgentChat } from '../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../lib/agent_runtime_config';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { hasTeamAccess } from '../lib/team_access';
import { createCustomAgentHookHandles, toSerializableConfig } from './config';

export const chatWithAgent = mutation({
  args: {
    agentId: v.id('customAgents'),
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

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args.threadId,
    });
    if (!thread || thread.userId !== String(authUser._id)) {
      throw new Error('Thread not found');
    }

    const rootVersionId = args.agentId;

    // Load the active published version
    const activeVersionQuery = ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', rootVersionId).eq('status', 'active'),
      );

    let activeVersion = null;
    for await (const doc of activeVersionQuery) {
      activeVersion = doc;
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

    // Check team access for non-system-default agents
    if (!activeVersion.isSystemDefault) {
      const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
      if (!hasTeamAccess(activeVersion, userTeamIds)) {
        throw new Error('Agent not accessible');
      }
    }

    const agentConfig = toSerializableConfig(activeVersion);
    const { model, provider } = getDefaultAgentRuntimeConfig();

    // Build RAG team IDs — needed when knowledge mode is not 'off'
    const knowledgeMode =
      activeVersion.knowledgeMode ??
      (activeVersion.knowledgeEnabled ? 'tool' : 'off');
    const ragTeamIds: string[] = [];
    if (knowledgeMode !== 'off') {
      if (activeVersion.teamId) ragTeamIds.push(activeVersion.teamId);
      if (activeVersion.includeOrgKnowledge) {
        ragTeamIds.push(`org_${args.organizationId}`);
      }
    }

    const hooks = await createCustomAgentHookHandles(
      ctx,
      activeVersion.filePreprocessingEnabled,
    );

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
      debugTag: `[Agent:${activeVersion.name}]`,
      enableStreaming: true,
      ragTeamIds: ragTeamIds.length > 0 ? ragTeamIds : undefined,
      hooks,
    });
  },
});
