/**
 * Routing Agent Mutations
 */

import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { authComponent } from '../../auth';
import { startAgentChat } from '../../lib/agent_chat';
import {
  CHAT_AGENT_CONFIG,
  createChatHookHandles,
  getChatAgentRuntimeConfig,
} from './config';

export const chatWithAgent = mutation({
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

    const runtimeConfig = getChatAgentRuntimeConfig();
    const hooks = await createChatHookHandles(ctx);

    return startAgentChat({
      ctx,
      agentType: 'chat',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig: CHAT_AGENT_CONFIG,
      model: runtimeConfig.model,
      provider: runtimeConfig.provider,
      debugTag: runtimeConfig.debugTag,
      enableStreaming: runtimeConfig.enableStreaming,
      hooks,
    });
  },
});
