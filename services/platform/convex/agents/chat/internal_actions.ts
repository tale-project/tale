'use node';

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import {
  agentResponseReturnsValidator,
  generateAgentResponse,
} from '../../lib/agent_response';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { createDebugLog } from '../../lib/debug_log';
import { createChatAgent, CHAT_AGENT_INSTRUCTIONS } from './agent';

const debugLog = createDebugLog('DEBUG_ROUTING_AGENT', '[RoutingAgent]');

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    organizationId: v.string(),
    promptMessage: v.string(),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    parentThreadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    maxSteps: v.optional(v.number()),
    userTeamIds: v.optional(v.array(v.string())),
  },
  returns: agentResponseReturnsValidator,
  handler: async (ctx, args) => {
    const { model, provider } = getDefaultAgentRuntimeConfig();

    return generateAgentResponse(
      {
        agentType: 'chat',
        createAgent: createChatAgent,
        model,
        provider,
        debugTag: '[ChatAgent]',
        enableStreaming: !!args.streamId,
        instructions: CHAT_AGENT_INSTRUCTIONS,
      },
      {
        ctx,
        threadId: args.threadId,
        userId: args.userId,
        organizationId: args.organizationId,
        promptMessage: args.promptMessage,
        additionalContext: args.additionalContext,
        parentThreadId: args.parentThreadId,
        streamId: args.streamId,
        promptMessageId: args.promptMessageId,
        maxSteps: args.maxSteps,
        userTeamIds: args.userTeamIds,
      },
    );
  },
});

export const beforeContextHook = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    promptMessage: v.string(),
    organizationId: v.string(),
    userTeamIds: v.optional(v.array(v.string())),
    contextFeatures: v.optional(v.array(v.string())),
  },
  returns: v.object({
    integrationsInfo: v.optional(v.string()),
    integrationsList: v.optional(v.array(v.any())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    integrationsInfo?: string;
    integrationsList?: Record<string, unknown>[];
  }> => {
    const { threadId, organizationId, contextFeatures } = args;

    // Determine which features to load.
    // undefined = load all (backward compat for callers that don't pass contextFeatures)
    const shouldLoad = (feature: string) =>
      !contextFeatures || contextFeatures.includes(feature);

    let integrationsInfo: string | undefined;
    let integrationsList: Record<string, unknown>[] | undefined;

    if (shouldLoad('integrations')) {
      integrationsList = await ctx.runQuery(
        internal.integrations.internal_queries.listInternal,
        {
          organizationId,
        },
      );

      if (integrationsList && integrationsList.length > 0) {
        integrationsInfo = integrationsList
          .map((integration: Record<string, unknown>) => {
            const type =
              typeof integration.type === 'string'
                ? integration.type
                : 'rest_api';
            const status =
              typeof integration.status === 'string'
                ? integration.status
                : 'active';
            const name =
              typeof integration.name === 'string' ? integration.name : '';
            const title =
              typeof integration.title === 'string' ? integration.title : name;
            const desc =
              typeof integration.description === 'string'
                ? ` - ${integration.description}`
                : '';
            return `• ${name} (${type}, ${status}): ${title}${desc}`;
          })
          .join('\n');
      }
    }

    debugLog('Initial context loaded', {
      threadId,
      integrationsCount: integrationsList?.length ?? 0,
      contextFeatures,
    });

    return {
      integrationsInfo,
      integrationsList: integrationsList ?? undefined,
    };
  },
});
