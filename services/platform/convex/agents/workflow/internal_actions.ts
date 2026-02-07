'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { agentResponseReturnsValidator } from '../../lib/agent_response';
import { generateWorkflowResponse } from './generate_response';

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    organizationId: v.string(),
    promptMessage: v.string(),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    parentThreadId: v.optional(v.string()),
    delegationMode: v.optional(v.boolean()),
  },
  returns: agentResponseReturnsValidator,
  handler: async (ctx, args) => {
    return generateWorkflowResponse({
      ctx,
      threadId: args.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      promptMessage: args.promptMessage,
      additionalContext: args.additionalContext,
      parentThreadId: args.parentThreadId,
      delegationMode: args.delegationMode,
    });
  },
});
