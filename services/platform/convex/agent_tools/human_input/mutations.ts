import { saveMessage } from '@convex-dev/agent';
import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { HumanInputRequestMetadata } from '../../../lib/shared/schemas/approvals';

import { components, internal } from '../../_generated/api';
import { mutation } from '../../_generated/server';
import { toSerializableConfig } from '../../custom_agents/config';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { getUserTeamIds } from '../../lib/get_user_teams';
import { getOrganizationMember } from '../../lib/rls';
import { persistentStreaming } from '../../streaming/helpers';

const beforeContextHookRef = makeFunctionReference<'action'>(
  'agents/chat/internal_actions:beforeContextHook',
);
const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

export const submitHumanInputResponse = mutation({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    threadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error('Human input request has already been responded to');
    }

    if (approval.resourceType !== 'human_input_request') {
      throw new Error('Invalid approval type');
    }

    const threadId = approval.threadId;
    const organizationId = approval.organizationId;

    if (!threadId) {
      throw new Error('Human input request is not associated with a thread');
    }

    await getOrganizationMember(ctx, organizationId);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is stored as v.any() but always matches HumanInputRequestMetadata for human_input_request approvals
    const existingMetadata = (approval.metadata ||
      {}) as HumanInputRequestMetadata;
    const respondedBy = identity.email ?? identity.subject;

    const updatedMetadata: HumanInputRequestMetadata = {
      ...existingMetadata,
      response: {
        value: args.response,
        respondedBy,
        timestamp: Date.now(),
      },
    };

    await ctx.db.patch(args.approvalId, {
      status: 'approved',
      approvedBy: identity.subject,
      reviewedAt: Date.now(),
      metadata: updatedMetadata,
    });

    const mapValueToLabel = (value: string): string => {
      if (existingMetadata.options) {
        const option = existingMetadata.options.find(
          (opt) => (opt.value ?? opt.label) === value,
        );
        if (option) {
          return option.label;
        }
      }
      return value;
    };

    const responseDisplay = Array.isArray(args.response)
      ? args.response.map(mapValueToLabel).join(', ')
      : mapValueToLabel(args.response);
    const responseMessage = `User responded to question "${existingMetadata.question}": ${responseDisplay}`;

    const { messageId: promptMessageId } = await saveMessage(
      ctx,
      components.agent,
      {
        threadId,
        message: { role: 'user', content: responseMessage },
      },
    );

    const streamId = await persistentStreaming.createStream(ctx);

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });
    const userTeamIds = thread?.userId
      ? await getUserTeamIds(ctx, thread.userId)
      : [];

    // Load system default chat agent from DB
    const systemChatQuery = ctx.db
      .query('customAgents')
      .withIndex('by_org_system_slug', (q) =>
        q.eq('organizationId', organizationId).eq('systemAgentSlug', 'chat'),
      );

    let chatAgent = null;
    for await (const agent of systemChatQuery) {
      if (agent.isActive && agent.status === 'active') {
        chatAgent = agent;
        break;
      }
    }

    if (!chatAgent) {
      throw new Error('System default chat agent not found');
    }

    const agentConfig = toSerializableConfig(chatAgent);
    const { model, provider } = getDefaultAgentRuntimeConfig();

    const [beforeContext, beforeGenerate] = await Promise.all([
      createFunctionHandle(beforeContextHookRef),
      createFunctionHandle(beforeGenerateHookRef),
    ]);

    await ctx.scheduler.runAfter(
      0,
      internal.lib.agent_chat.internal_actions.runAgentGeneration,
      {
        agentType: 'custom',
        agentConfig,
        model: agentConfig.model ?? model,
        provider,
        debugTag: '[ChatAgent:HumanInput]',
        enableStreaming: true,
        hooks: { beforeContext, beforeGenerate },
        threadId,
        organizationId,
        promptMessage: responseMessage,
        streamId,
        promptMessageId,
        maxSteps: 500,
        userId: thread?.userId,
        userTeamIds,
      },
    );

    return {
      success: true,
      threadId,
      streamId,
    };
  },
});
