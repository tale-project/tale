/**
 * Convex Tool: Create Workflow with Approval
 *
 * Creates a new workflow definition with all steps.
 * Requires user approval before the workflow is actually created.
 * This enables AI to propose workflows in chat that users can review and approve.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { internal } from '../../_generated/api';
import { validateWorkflowDefinition } from '../../workflow/helpers/validation/validate_workflow_definition';

const workflowConfigSchema = z.object({
  name: z
    .string()
    .describe(
      'Human-readable workflow name (must be unique per organization).',
    ),
  description: z
    .string()
    .optional()
    .describe('Optional description explaining what the workflow does.'),
  version: z
    .string()
    .optional()
    .describe('Optional version label, e.g. "v1", "v2".'),
  workflowType: z
    .enum(['predefined'])
    .optional()
    .describe('Workflow type; currently only "predefined" is supported.'),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional workflow-level configuration object.'),
});

const stepConfigSchema = z.object({
  stepSlug: z
    .string()
    .describe('Unique step slug in snake_case (e.g., "find_customers").'),
  name: z
    .string()
    .describe('Human-readable step name (e.g., "Find Inactive Customers").'),
  stepType: z
    .enum(['trigger', 'llm', 'action', 'condition', 'loop'])
    .describe('Step type.'),
  order: z
    .number()
    .describe('Step order number (determines execution sequence).'),
  config: z
    .record(z.string(), z.unknown())
    .describe('Step configuration object; structure depends on step type.'),
  nextSteps: z
    .record(z.string(), z.string())
    .describe(
      'Next step connections (e.g., {success: "next_step_id", failure: "error_handler"}).',
    ),
});

export const createWorkflowTool = {
  name: 'create_workflow' as const,
  tool: createTool({
    description: `Create a new workflow definition with all steps.
IMPORTANT: This operation requires user approval before the workflow is created. An approval card will be shown in the chat for the user to review and approve.
Before using this tool, ALWAYS call workflow_examples first to find similar workflows and copy their config structure to avoid schema validation errors.

CRITICAL PATTERN - Processing Multiple Records:
When creating workflows that process multiple customers/products (e.g., "send email to all inactive customers"):
• NEVER loop through all records at once
• ALWAYS use 'workflow_processing_records' action type:
  1. Step with type='action', config.type='workflow_processing_records', config.parameters.operation='find_unprocessed' to get ONE record
  2. Process that single record (LLM analysis, create conversation, etc.)
  3. Step with type='action', config.type='workflow_processing_records', config.parameters.operation='record_processed' to mark done
  4. Workflow runs on schedule (e.g., every 5 minutes) and processes one record per run
• config.parameters.tableName: 'customers' or 'products'
• config.parameters.backoffHours: hours before a record can be reprocessed
• Reference 'generalCustomerStatusAssessment' or 'productRecommendationEmail' workflows as examples`,
    args: z.object({
      workflowConfig: workflowConfigSchema,
      stepsConfig: z
        .array(stepConfigSchema)
        .describe('Complete list of steps for this workflow.'),
    }),
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
      validationErrors?: string[];
      validationWarnings?: string[];
    }> => {
      const { organizationId, threadId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to create a workflow.',
        };
      }

      // Validate workflow definition before creating approval
      const validation = validateWorkflowDefinition(
        args.workflowConfig,
        args.stepsConfig as Array<Record<string, unknown>>,
      );

      if (!validation.valid) {
        return {
          success: false,
          message: `Workflow validation failed with ${validation.errors.length} error(s). Fix the errors and try again.`,
          validationErrors: validation.errors,
          validationWarnings:
            validation.warnings.length > 0 ? validation.warnings : undefined,
        };
      }

      // Create an approval for the workflow creation
      try {
        const approvalId = await ctx.runMutation(
          internal.agent_tools.workflows.create_workflow_approval
            .createWorkflowCreationApproval,
          {
            organizationId,
            workflowName: args.workflowConfig.name,
            workflowDescription: args.workflowConfig.description,
            workflowConfig: args.workflowConfig,
            stepsConfig: args.stepsConfig,
            threadId,
          },
        );

        return {
          success: true,
          requiresApproval: true,
          approvalId: approvalId as string,
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for workflow "${args.workflowConfig.name}". The user must approve this workflow creation in the chat UI before it will be created.`,
          message: `Workflow "${args.workflowConfig.name}" is ready for approval. An approval card has been created. The workflow will be created once the user approves it.`,
          validationWarnings:
            validation.warnings.length > 0 ? validation.warnings : undefined,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create workflow approval: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
