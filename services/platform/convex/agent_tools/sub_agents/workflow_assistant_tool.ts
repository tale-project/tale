/**
 * Workflow Assistant Tool
 *
 * Delegates ALL workflow-related tasks to the specialized Workflow Assistant Agent.
 * This is the single entry point for workflow operations from the Chat Agent.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createWorkflowAgent } from '../../lib/create_workflow_agent';
import { internal } from '../../_generated/api';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';

/** Roles that are allowed to use the workflow assistant tool */
const ALLOWED_ROLES = ['admin', 'developer'] as const;

export const workflowAssistantTool = {
  name: 'workflow_assistant' as const,
  tool: createTool({
    description: `Delegate ALL workflow-related tasks to the specialized Workflow Assistant Agent.

Use this tool for ANY workflow-related request, including:
- Listing existing workflows
- Viewing workflow details or structure
- Designing new workflows from natural language
- Modifying existing workflows
- Explaining workflow concepts or syntax
- Creating workflows (will show approval card)
- Browsing workflow examples/templates

The Workflow Assistant is a specialized expert with:
- Deep knowledge of workflow syntax and best practices
- Access to predefined workflow templates
- Ability to create approval cards for workflow creation
- Full workflow CRUD capabilities

Simply pass the user's request - the Workflow Assistant will handle everything.`,

    args: z.object({
      userRequest: z
        .string()
        .describe("The user's workflow-related request in natural language"),
      workflowId: z
        .string()
        .optional()
        .describe('Workflow ID if the request is about a specific workflow'),
    }),

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      response: string;
      approvalCreated?: boolean;
      approvalId?: string;
      error?: string;
    }> => {
      const { organizationId, threadId, userId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          response: '',
          error: 'organizationId is required',
        };
      }

      // Agent SDK requires either userId or threadId to be specified
      if (!threadId && !userId) {
        return {
          success: false,
          response: '',
          error: 'Either threadId or userId is required',
        };
      }

      // Check user role - only admin, developer, and owner can use this tool
      if (userId) {
        const userRole = await ctx.runQuery(internal.member.getMemberRoleInternal, {
          userId,
          organizationId,
        });

        const normalizedRole = (userRole ?? 'member').toLowerCase();
        if (!ALLOWED_ROLES.includes(normalizedRole as typeof ALLOWED_ROLES[number])) {
          console.log('[workflow_assistant_tool] Access denied for role:', normalizedRole);
          return {
            success: false,
            response: '',
            error: `Access denied: The workflow assistant is only available to users with admin or developer roles. Your current role is "${normalizedRole}".`,
          };
        }
      }

      try {
        // Create the Workflow Agent in delegation mode (has all workflow tools)
        const workflowAgent = createWorkflowAgent({
          delegationMode: true,
          withTools: true,
        });

        // Log agent configuration to verify maxSteps is set
        console.log('[workflow_assistant_tool] Agent config:', {
          name: workflowAgent.options.name,
          hasTools: !!workflowAgent.options.tools,
          toolCount: workflowAgent.options.tools
            ? Object.keys(workflowAgent.options.tools).length
            : 0,
          // Check if maxSteps is set in the agent options
          maxSteps: (workflowAgent.options as Record<string, unknown>).maxSteps,
        });

        // Build the prompt with context
        let prompt = `## User Request:\n${args.userRequest}\n\n`;
        if (args.workflowId) {
          prompt += `## Target Workflow ID: ${args.workflowId}\n\n`;
        }
        prompt += `## Context:\n`;
        prompt += `- Organization ID: ${organizationId}\n`;
        if (threadId) {
          prompt += `- Parent Thread ID: ${threadId}\n`;
        }
        if (userId) {
          prompt += `- User ID: ${userId}\n`;
        }

        console.log('[workflow_assistant_tool] Calling workflowAgent.generateText');
        console.log('[workflow_assistant_tool] Prompt:', prompt);

        // Get or create a sub-thread for this parent thread + sub-agent combination
        // Reusing the thread allows the sub-agent to maintain context across calls
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId!,
            subAgentType: 'workflow_assistant',
            userId,
          },
        );

        console.log('[workflow_assistant_tool] Sub-thread:', subThreadId, isNew ? '(new)' : '(reused)');
        console.log('[workflow_assistant_tool] Parent thread for approvals:', threadId);

        // Extend the context with parentThreadId so that tools (like create_workflow)
        // can link approvals to the parent thread instead of the sub-thread
        const contextWithParentThread = {
          ...ctx,
          parentThreadId: threadId,
        };

        // Use the new sub-thread for the generation, but pass the parent threadId
        // in the context so that approvals are linked to the parent thread
        // Note: maxSteps is configured in createWorkflowAgent (20 for delegation mode)
        const generationStartTime = Date.now();
        const result = await workflowAgent.generateText(
          contextWithParentThread,
          { threadId: subThreadId, userId },
          { prompt },
        );
        const generationDurationMs = Date.now() - generationStartTime;

        // Log summary (detailed step logging removed to reduce log volume)
        console.log('[workflow_assistant_tool] Result:', {
          durationMs: generationDurationMs,
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
          stepsCount: result.steps?.length ?? 0,
        });

        // Check if an approval was created
        const approvalMatch = result.text.match(/APPROVAL_CREATED:(\w+)/);

        return {
          success: true,
          response: result.text.replace(/APPROVAL_CREATED:\w+/g, '').trim(),
          approvalCreated: !!approvalMatch,
          approvalId: approvalMatch?.[1],
        };
      } catch (error) {
        console.error('[workflow_assistant_tool] Error:', error);
        return {
          success: false,
          response: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
