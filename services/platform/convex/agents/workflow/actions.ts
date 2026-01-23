'use node';

/**
 * Workflow Agent Convex Actions
 *
 * Public and internal action entry points for the Workflow Agent.
 * - chatWithWorkflowAssistant: Public action for the automation assistant UI
 * - generateResponse: Internal action called by the workflow_assistant tool
 */

import { v } from 'convex/values';
import { action, internalAction } from '../../_generated/server';
import { components } from '../../_generated/api';
import { saveMessage } from '@convex-dev/agent';
import { authComponent } from '../../auth';
import { agentResponseReturnsValidator } from '../../lib/agent_response';
import { generateWorkflowResponse } from './generate_response';
import { getGetWorkflowInternalRef } from '../../lib/function_refs';

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    organizationId: v.string(),
    taskDescription: v.string(),
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
      taskDescription: args.taskDescription,
      additionalContext: args.additionalContext,
      parentThreadId: args.parentThreadId,
      delegationMode: args.delegationMode,
    });
  },
});

export const chatWithWorkflowAssistant = action({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    workflowId: v.optional(v.id('wfDefinitions')),
    message: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.string(),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    const { threadId, organizationId, workflowId, message } = args;

    try {
      // Save the user message to the thread first
      const { messageId: promptMessageId } = await saveMessage(
        ctx,
        components.agent,
        {
          threadId,
          message: { role: 'user', content: message },
        },
      );

      // Build additional context for the task
      const additionalContext: Record<string, string> = {};
      if (workflowId) {
        const workflow = await ctx.runQuery(getGetWorkflowInternalRef(), {
          wfDefinitionId: workflowId,
        });
        if (workflow) {
          additionalContext.target_workflow_id = String(workflowId);
          additionalContext.target_workflow_name = workflow.name;
        }
      }

      // Call the Workflow Agent with the saved message
      await generateWorkflowResponse({
        ctx,
        threadId,
        userId: String(authUser._id),
        organizationId,
        taskDescription: message,
        additionalContext:
          Object.keys(additionalContext).length > 0
            ? additionalContext
            : undefined,
        delegationMode: false,
        promptMessageId,
      });

      return { success: true };
    } catch (error) {
      console.error('[chatWithWorkflowAssistant] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
