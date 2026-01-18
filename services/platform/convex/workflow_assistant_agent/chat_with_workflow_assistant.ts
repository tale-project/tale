'use node';

/**
 * Public action to chat with the Workflow Assistant
 *
 * This action handles messages sent to the workflow assistant
 * from the automation assistant UI.
 */

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { internal } from '../_generated/api';
import { authComponent } from '../auth';
import { createWorkflowAgent } from '../lib/create_workflow_agent';
import { createContextHandler, AGENT_CONTEXT_CONFIGS } from '../lib/context_management';

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
      // Build workflow context if a specific workflow is selected
      let workflowContext = '';
      if (workflowId) {
        const workflow = await ctx.runQuery(
          internal.wf_definitions.queries.getWorkflow.getWorkflowInternal,
          { wfDefinitionId: workflowId },
        );
        if (workflow) {
          workflowContext = `\n\nCurrent Workflow Context:\nWorkflow ID: ${workflowId}\nWorkflow Name: ${workflow.name}\nOrganization: ${organizationId}`;
        }
      }

      // Create the Workflow Agent
      const workflowAgent = createWorkflowAgent({
        withTools: true,
        workflowContext,
      });

      // Create context handler
      const workflowConfig = AGENT_CONTEXT_CONFIGS.workflow;
      const contextHandler = createContextHandler({
        modelContextLimit: workflowConfig.modelContextLimit,
        outputReserve: workflowConfig.outputReserve,
        minRecentMessages: workflowConfig.recentMessages,
      });

      // Generate the response - messages are automatically stored in the thread
      await workflowAgent.generateText(
        ctx,
        { threadId, userId: String(authUser._id) },
        {
          prompt: message,
        },
        {
          contextOptions: {
            recentMessages: workflowConfig.recentMessages,
            excludeToolMessages: false,
          },
          contextHandler,
        },
      );

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
