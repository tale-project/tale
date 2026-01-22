'use node';

/**
 * Web Agent Convex Actions
 *
 * Public and internal action entry points for the Web Agent.
 * These can be called directly (independent mode) or via the web_assistant tool.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { agentResponseReturnsValidator } from '../../lib/agent_response';
import { generateWebResponse } from './generate_response';

/**
 * Internal action to generate a web agent response.
 *
 * Called by the web_assistant tool or can be scheduled directly.
 */
export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    organizationId: v.string(),
    taskDescription: v.string(),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    parentThreadId: v.optional(v.string()),
  },
  returns: agentResponseReturnsValidator,
  handler: async (ctx, args) => {
    return generateWebResponse({
      ctx,
      threadId: args.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      taskDescription: args.taskDescription,
      additionalContext: args.additionalContext,
      parentThreadId: args.parentThreadId,
    });
  },
});
