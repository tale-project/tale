'use node';

/**
 * Chat Agent Convex Actions
 *
 * Internal action entry points for the Chat (Routing) Agent.
 * Note: Chat agent is primarily called via mutations.ts, but this
 * provides a consistent interface with other agents.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { agentResponseReturnsValidator, generateAgentResponse } from '../../lib/agent_response';
import { createChatAgent } from './agent';

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    organizationId: v.string(),
    taskDescription: v.string(),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    parentThreadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    maxSteps: v.optional(v.number()),
    userTeamIds: v.optional(v.array(v.string())),
  },
  returns: agentResponseReturnsValidator,
  handler: async (ctx, args) => {
    const model = process.env.OPENAI_MODEL;
    if (!model) {
      throw new Error('OPENAI_MODEL environment variable is not configured');
    }

    return generateAgentResponse(
      {
        agentType: 'chat',
        createAgent: createChatAgent,
        model,
        provider: 'openai',
        debugTag: '[ChatAgent]',
        enableStreaming: !!args.streamId,
      },
      {
        ctx,
        threadId: args.threadId,
        userId: args.userId,
        organizationId: args.organizationId,
        taskDescription: args.taskDescription,
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
