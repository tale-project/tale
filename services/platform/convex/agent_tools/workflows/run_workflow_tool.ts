/**
 * Convex Tool: Run Workflow with Approval
 *
 * Triggers execution of an existing workflow definition.
 * Requires user approval before the workflow is actually started.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import { validateWorkflowInput } from '../../workflow_engine/helpers/validation/validate_workflow_input';
import { extractInputSchema } from './helpers/extract_input_schema';

const runWorkflowArgs = z.object({
  workflowId: z
    .string()
    .min(1)
    .describe(
      'The ID of the workflow definition to execute. Use workflow_read(operation="list_all") to find available workflows.',
    ),
  parameters: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Optional input parameters passed to the workflow as initial variables. Keys become variable names accessible to all steps via {{variableName}}.',
    ),
});

export { runWorkflowArgs };

export const runWorkflowTool = {
  name: 'run_workflow' as const,
  tool: createTool({
    description: `Trigger execution of an existing workflow definition.

**WHEN TO USE:**
• Use this tool to run/execute a workflow that has already been created
• First use workflow_read(operation="list_all") to find the workflow ID
• Use workflow_read(operation="get_structure") to understand expected input parameters

**DO NOT USE THIS TOOL FOR:**
• Creating new workflows — use create_workflow instead
• Reading workflow details — use workflow_read instead
• Updating workflow steps — use update_workflow_step instead

**APPROVAL REQUIRED:**
This tool creates an approval card in the chat. The user must click "Run Workflow" to confirm execution. The workflow will NOT start until approved.

**PARAMETERS:**
• workflowId (required): The workflow definition ID
• parameters (optional): JSON object of input variables for the workflow

**EXAMPLE:**
{ "workflowId": "abc123", "parameters": { "targetFolder": "/invoices", "daysBack": 30 } }`,
    args: runWorkflowArgs,
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      requiresApproval?: boolean;
      approvalId?: string;
      approvalCreated?: boolean;
      approvalMessage?: string;
      message: string;
    }> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to run a workflow.',
        };
      }

      // Look up workflow definition
      const wfDefinition = await ctx.runQuery(
        internal.wf_definitions.internal_queries.resolveWorkflow,
        { wfDefinitionId: toId<'wfDefinitions'>(args.workflowId) },
      );

      if (!wfDefinition) {
        return {
          success: false,
          message: `Workflow with ID "${args.workflowId}" not found.`,
        };
      }

      // Validate org ownership (resolveWorkflow does NOT check this)
      if (wfDefinition.organizationId !== organizationId) {
        return {
          success: false,
          message: `Workflow "${args.workflowId}" does not belong to the current organization.`,
        };
      }

      // Reject archived workflows
      if (wfDefinition.status === 'archived') {
        return {
          success: false,
          message: `Workflow "${wfDefinition.name}" is archived and cannot be executed. Only active or draft workflows can be run.`,
        };
      }

      // Validate input parameters against the start step's inputSchema
      const startStepConfig = await ctx.runQuery(
        internal.wf_definitions.internal_queries.getStartStepConfig,
        { wfDefinitionId: wfDefinition._id },
      );

      const inputSchema = extractInputSchema(startStepConfig);
      const validation = validateWorkflowInput(args.parameters, inputSchema);

      if (!validation.valid) {
        return {
          success: false,
          message: `Invalid workflow parameters: ${validation.errors.join('; ')}. Use workflow_read(operation="get_structure") to check the expected input schema.`,
        };
      }

      // Get stable parent thread ID for approval linking
      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      try {
        const approvalId = await ctx.runMutation(
          internal.agent_tools.workflows.internal_mutations
            .createWorkflowRunApproval,
          {
            organizationId,
            workflowId: wfDefinition._id,
            workflowName: wfDefinition.name,
            workflowDescription: wfDefinition.description,
            parameters: args.parameters,
            threadId,
            messageId,
          },
        );

        return {
          success: true,
          requiresApproval: true,
          approvalId,
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created to run workflow "${wfDefinition.name}". The user must approve this in the chat UI before execution begins.`,
          message: `Workflow "${wfDefinition.name}" is ready to run. An approval card has been created. The workflow will start once the user approves it.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create workflow run approval: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
