/**
 * Workflow Assistant Tool
 *
 * Delegates ALL workflow-related tasks to the specialized Workflow Agent.
 * This tool is a thin wrapper that creates sub-threads and calls the agent.
 * All context management is handled by the agent itself.
 *
 * Requires admin/developer role for access.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import {
  getGetMemberRoleInternalRef,
  getWorkflowAgentGenerateResponseRef,
} from '../../lib/function_refs';

const ALLOWED_ROLES = ['admin', 'developer'] as const;

export const workflowAssistantTool = {
  name: 'workflow_assistant' as const,
  tool: createTool({
    description: `Delegate ALL workflow-related tasks to the specialized Workflow Agent.

Use this tool for ANY workflow-related request, including:
- Listing existing workflows
- Viewing workflow details or structure
- Designing new workflows from natural language
- Modifying existing workflows
- Explaining workflow concepts or syntax
- Creating workflows (will show approval card)
- Browsing workflow examples/templates

The Workflow Agent is a specialized expert with:
- Deep knowledge of workflow syntax and best practices
- Access to predefined workflow templates
- Ability to create approval cards for workflow creation
- Full workflow CRUD capabilities

Simply pass the user's request - the Workflow Agent will handle everything.`,

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
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }> => {
      const { organizationId, threadId, userId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          response: '',
          error: 'organizationId is required',
        };
      }

      if (!threadId) {
        return {
          success: false,
          response: '',
          error: 'threadId is required for workflow_assistant to create sub-threads',
        };
      }

      // Check user role - only admin and developer can use this tool
      if (userId) {
        const userRole = await ctx.runQuery(
          getGetMemberRoleInternalRef(),
          { userId, organizationId },
        );

        const normalizedRole = (userRole ?? 'member').toLowerCase();
        if (!ALLOWED_ROLES.includes(normalizedRole as (typeof ALLOWED_ROLES)[number])) {
          console.log('[workflow_assistant_tool] Access denied for role:', normalizedRole);
          return {
            success: false,
            response: '',
            error: `Access denied: The workflow assistant is only available to users with admin or developer roles. Your current role is "${normalizedRole}".`,
          };
        }
      }

      try {
        // Get or create a sub-thread for this parent thread + agent combination
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'workflow_assistant',
            userId,
          },
        );

        console.log(
          '[workflow_assistant_tool] Sub-thread:',
          subThreadId,
          isNew ? '(new)' : '(reused)',
        );
        console.log('[workflow_assistant_tool] Parent thread for approvals:', threadId);

        // Build additional context for the agent
        const additionalContext: Record<string, string> = {};
        if (args.workflowId) {
          additionalContext.target_workflow_id = args.workflowId;
        }

        // Call the Workflow Agent in delegation mode - all context management happens inside
        const result = await ctx.runAction(
          getWorkflowAgentGenerateResponseRef(),
          {
            threadId: subThreadId,
            userId,
            organizationId,
            taskDescription: args.userRequest,
            additionalContext:
              Object.keys(additionalContext).length > 0
                ? additionalContext
                : undefined,
            parentThreadId: threadId,
            delegationMode: true,
          },
        );

        // Check if an approval was created
        const approvalMatch = result.text.match(/APPROVAL_CREATED:(\w+)/);

        return {
          success: true,
          response: result.text.replace(/APPROVAL_CREATED:\w+/g, '').trim(),
          approvalCreated: !!approvalMatch,
          approvalId: approvalMatch?.[1],
          usage: result.usage,
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
