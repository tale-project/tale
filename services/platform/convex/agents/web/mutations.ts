/**
 * Web Agent Mutations
 */

import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import type { ToolName } from '../../agent_tools/tool_registry';
import { authComponent } from '../../auth';
import { startAgentChat } from '../../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { WEB_AGENT_INSTRUCTIONS } from './agent';

const WEB_AGENT_TOOL_NAMES: ToolName[] = ['web', 'request_human_input'];

const WEB_AGENT_CONFIG: SerializableAgentConfig = {
  name: 'web-assistant',
  instructions: WEB_AGENT_INSTRUCTIONS,
  convexToolNames: WEB_AGENT_TOOL_NAMES,
  maxSteps: 5,
};

export const chatWithWebAgent = mutation({
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

    const { model, provider } = getDefaultAgentRuntimeConfig();
    return startAgentChat({
      ctx,
      agentType: 'web',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig: WEB_AGENT_CONFIG,
      model,
      provider,
      debugTag: '[WebAgent]',
      enableStreaming: true,
    });
  },
});
