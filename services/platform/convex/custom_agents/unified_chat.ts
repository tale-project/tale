/**
 * Unified Chat Mutation
 *
 * Single entry point for chatting with any agent (system default or custom).
 * Replaces the three separate chat mutations:
 * - chatWithAgent (default routing agent)
 * - chatWithBuiltinAgent (builtin specialist agents)
 * - chatWithCustomAgent (user-created custom agents)
 *
 * If no agentId is provided, the organization's system default 'chat' agent is used.
 */

import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { AgentHooksConfig } from '../lib/agent_chat/types';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { startAgentChat } from '../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../lib/agent_runtime_config';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { hasTeamAccess } from '../lib/team_access';
import { createCustomAgentHookHandles, toSerializableConfig } from './config';

const beforeContextHookRef = makeFunctionReference<'action'>(
  'agents/chat/internal_actions:beforeContextHook',
);

async function resolveAgentId(
  ctx: MutationCtx,
  agentId: Id<'customAgents'> | undefined,
  organizationId: string,
): Promise<Id<'customAgents'>> {
  if (agentId) return agentId;

  const systemChat = ctx.db
    .query('customAgents')
    .withIndex('by_org_system_slug', (q) =>
      q.eq('organizationId', organizationId).eq('systemAgentSlug', 'chat'),
    );

  for await (const agent of systemChat) {
    if (agent.status === 'active' && agent.rootVersionId) {
      return agent.rootVersionId;
    }
  }

  throw new Error(
    'System default assistant agent not found. Organization may need initialization.',
  );
}

export const chatWithAgent = mutation({
  args: {
    agentId: v.optional(v.id('customAgents')),
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

    // Resolve agent: use provided ID or fall back to system default 'chat' agent
    const rootVersionId = await resolveAgentId(
      ctx,
      args.agentId,
      args.organizationId,
    );

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

    // Build hooks: system default chat agent gets beforeContext (integrations loading)
    let hooks: AgentHooksConfig | undefined =
      await createCustomAgentHookHandles(
        ctx,
        activeVersion.filePreprocessingEnabled,
      );

    if (activeVersion.systemAgentSlug === 'chat') {
      const beforeContext = await createFunctionHandle(beforeContextHookRef);
      hooks = { ...hooks, beforeContext };
    }

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
