/**
 * Document Agent Mutations
 *
 * Public mutations for the Document Agent.
 * Allows direct chat with the document agent from the frontend.
 */

import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { authComponent } from '../../auth';
import { startAgentChat } from '../../lib/agent_chat';
import { DOCUMENT_AGENT_INSTRUCTIONS } from './agent';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import type { ToolName } from '../../agent_tools/tool_registry';

const DOCUMENT_AGENT_TOOL_NAMES: ToolName[] = [
  'pdf',
  'image',
  'docx',
  'pptx',
  'generate_excel',
  'request_human_input',
];

const DOCUMENT_AGENT_CONFIG: SerializableAgentConfig = {
  name: 'document-assistant',
  instructions: DOCUMENT_AGENT_INSTRUCTIONS,
  convexToolNames: DOCUMENT_AGENT_TOOL_NAMES,
  useFastModel: true,
  maxSteps: 15,
};

export const chatWithDocumentAgent = mutation({
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
      agentType: 'document',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig: DOCUMENT_AGENT_CONFIG,
      model: process.env.OPENAI_FAST_MODEL || '',
      provider: 'openai',
      debugTag: '[DocumentAgent]',
      enableStreaming: true,
    });
  },
});
