/**
 * Integration Agent Mutations
 *
 * Public mutations for the Integration Agent.
 * Allows direct chat with the integration agent from the frontend.
 * Requires admin/developer role for access.
 */

import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { authComponent } from '../../auth';
import { startAgentChat } from '../../lib/agent_chat';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { INTEGRATION_AGENT_INSTRUCTIONS } from './agent';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import type { ToolName } from '../../agent_tools/tool_registry';

const ALLOWED_ROLES = ['admin', 'developer'] as const;

const INTEGRATION_AGENT_TOOL_NAMES: ToolName[] = [
  'integration',
  'integration_batch',
  'integration_introspect',
  'verify_approval',
  'request_human_input',
];

const INTEGRATION_AGENT_CONFIG: SerializableAgentConfig = {
  name: 'integration-assistant',
  instructions: INTEGRATION_AGENT_INSTRUCTIONS,
  convexToolNames: INTEGRATION_AGENT_TOOL_NAMES,
  maxSteps: 20,
};

export const chatWithIntegrationAgent = mutation({
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

    const userRole = await ctx.runQuery(
      internal.members.queries.getMemberRoleInternal,
      { userId: String(authUser._id), organizationId: args.organizationId },
    );

    const normalizedRole = (userRole ?? 'member').toLowerCase();
    if (!ALLOWED_ROLES.includes(normalizedRole as (typeof ALLOWED_ROLES)[number])) {
      throw new Error(
        `Access denied: The integration assistant is only available to users with admin or developer roles. Your current role is "${normalizedRole}".`,
      );
    }

    const { model, provider } = getDefaultAgentRuntimeConfig();
    return startAgentChat({
      ctx,
      agentType: 'integration',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig: INTEGRATION_AGENT_CONFIG,
      model,
      provider,
      debugTag: '[IntegrationAgent]',
      enableStreaming: true,
    });
  },
});
