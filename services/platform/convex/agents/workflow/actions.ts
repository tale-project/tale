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
import { authComponent } from '../../auth';
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
  returns: v.object({
    text: v.string(),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
      }),
    ),
    finishReason: v.optional(v.string()),
    durationMs: v.number(),
  }),
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
      // Build additional context for the task
      const additionalContext: Record<string, string> = {};
      if (workflowId) {
        const workflow = await ctx.runQuery(
          getGetWorkflowInternalRef(),
          { wfDefinitionId: workflowId },
        );
        if (workflow) {
          additionalContext.target_workflow_id = String(workflowId);
          additionalContext.target_workflow_name = workflow.name;
        }
      }

      // Call the Workflow Agent - all context management happens inside
      await generateWorkflowResponse({
        ctx,
        threadId,
        userId: String(authUser._id),
        organizationId,
        taskDescription: message,
        additionalContext:
          Object.keys(additionalContext).length > 0 ? additionalContext : undefined,
        delegationMode: false,
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
