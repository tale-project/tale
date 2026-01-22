/**
 * CRM Agent Mutations
 *
 * Public mutations for the CRM Agent.
 * Allows direct chat with the CRM agent from the frontend.
 */

import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { authComponent } from '../../auth';
import { startAgentChat } from '../../lib/agent_chat';
import { CRM_AGENT_INSTRUCTIONS } from './agent';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import type { ToolName } from '../../agent_tools/tool_registry';

const CRM_AGENT_TOOL_NAMES: ToolName[] = [
  'customer_read',
  'product_read',
  'request_human_input',
];

const CRM_AGENT_CONFIG: SerializableAgentConfig = {
  name: 'crm-assistant',
  instructions: CRM_AGENT_INSTRUCTIONS,
  convexToolNames: CRM_AGENT_TOOL_NAMES,
  useFastModel: true,
  maxSteps: 10,
};

export const chatWithCrmAgent = mutation({
  args: {
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

    return startAgentChat({
      ctx,
      agentType: 'crm',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig: CRM_AGENT_CONFIG,
      model: process.env.OPENAI_FAST_MODEL || '',
      provider: 'openai',
      debugTag: '[CrmAgent]',
      enableStreaming: true,
    });
  },
});
