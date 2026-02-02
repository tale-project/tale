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
import { validateToolContext } from './helpers/validate_context';
import { buildAdditionalContext } from './helpers/build_additional_context';
import { checkRoleAccess } from './helpers/check_role_access';
import {
  handleToolError,
  type ToolResponseWithApproval,
} from './helpers/tool_response';
import { getWorkflowAgentGenerateResponseRef } from '../../lib/function_refs';

const WORKFLOW_CONTEXT_MAPPING = {
  workflowId: 'target_workflow_id',
} as const;

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

    handler: async (ctx: ToolCtx, args): Promise<ToolResponseWithApproval> => {
      const validation = validateToolContext(ctx, 'workflow_assistant');
      if (!validation.valid) return validation.error;

      const { organizationId, threadId, userId } = validation.context;

      if (userId) {
        const roleCheck = await checkRoleAccess(
          ctx,
          userId,
          organizationId,
          'workflow_assistant',
        );
        if (!roleCheck.allowed) return roleCheck.error!;
      }

      try {
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
        console.log(
          '[workflow_assistant_tool] Parent thread for approvals:',
          threadId,
        );

        const result = await ctx.runAction(
          getWorkflowAgentGenerateResponseRef(),
          {
            threadId: subThreadId,
            userId,
            organizationId,
            promptMessage: args.userRequest,
            additionalContext: buildAdditionalContext(
              args,
              WORKFLOW_CONTEXT_MAPPING,
            ),
            parentThreadId: threadId,
            delegationMode: true,
          },
        );

        const approvalMatch = result.text.match(/APPROVAL_CREATED:(\w+)/);

        return {
          success: true,
          response: result.text.replace(/APPROVAL_CREATED:\w+/g, '').trim(),
          approvalCreated: !!approvalMatch,
          approvalId: approvalMatch?.[1],
          usage: {
            ...result.usage,
            durationSeconds: result.durationMs / 1000,
          },
          model: result.model,
          provider: result.provider,
        };
      } catch (error) {
        return handleToolError('workflow_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
