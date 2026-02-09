/**
 * Workflow Agent Mutations
 *
 * Requires admin/developer role for access.
 */

import { v } from 'convex/values';

import type { ToolName } from '../../agent_tools/tool_registry';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';

import { internal } from '../../_generated/api';
import { mutation } from '../../_generated/server';
import { authComponent } from '../../auth';
import { startAgentChat } from '../../lib/agent_chat';
import { WORKFLOW_AGENT_CORE_INSTRUCTIONS } from './agent';

const ALLOWED_ROLES = ['admin', 'developer'] as const;

const WORKFLOW_AGENT_TOOL_NAMES: ToolName[] = [
  'workflow_read',
  'workflow_examples',
  'update_workflow_step',
  'save_workflow_definition',
  'create_workflow',
  'database_schema',
];

function getWorkflowAgentConfig() {
  const model = process.env.OPENAI_CODING_MODEL;
  if (!model) {
    throw new Error(
      'OPENAI_CODING_MODEL environment variable is not configured',
    );
  }

  const config: SerializableAgentConfig = {
    name: 'workflow-assistant',
    instructions: WORKFLOW_AGENT_CORE_INSTRUCTIONS,
    convexToolNames: WORKFLOW_AGENT_TOOL_NAMES,
    model,
    maxSteps: 30,
  };

  return { config, model };
}

export const chatWithWorkflowAgent = mutation({
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
      internal.members.internal_queries.getMemberRole,
      { userId: String(authUser._id), organizationId: args.organizationId },
    );

    const normalizedRole = (userRole ?? 'member').toLowerCase();
    if (
      !ALLOWED_ROLES.includes(normalizedRole as (typeof ALLOWED_ROLES)[number])
    ) {
      throw new Error(
        `Access denied: The workflow assistant is only available to users with admin or developer roles. Your current role is "${normalizedRole}".`,
      );
    }

    const { config: agentConfig, model } = getWorkflowAgentConfig();

    return startAgentChat({
      ctx,
      agentType: 'workflow',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig,
      model,
      provider: 'openai',
      debugTag: '[WorkflowAgent]',
      enableStreaming: true,
    });
  },
});
