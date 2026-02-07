/**
 * Convex Tool: Create Workflow with Approval
 *
 * Creates a new workflow definition with all steps.
 * Requires user approval before the workflow is actually created.
 * This enables AI to propose workflows in chat that users can review and approve.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { internal } from '../../_generated/api';
import { validateWorkflowDefinition } from '../../workflow_engine/helpers/validation/validate_workflow_definition';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

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

**⭐ BEFORE USING THIS TOOL:**
1. Call workflow_examples(operation='get_syntax_reference', category='quick_start')
2. Call workflow_examples(operation='get_syntax_reference', category='common_patterns')
3. Optionally study a similar workflow with get_predefined

**CRITICAL JSON RULES:**
• Use ONLY double quotes (") for ALL strings - NEVER single quotes (')
• Escape quotes inside strings: \\"
• Escape newlines: \\n
• Do NOT include control characters or tabs in strings
• Verify JSON structure before calling this tool

**WORKFLOW CREATION:**
• This requires user approval - an approval card will be shown
• nextSteps goes at step level, NOT inside config
• LLM steps require: name + systemPrompt
• Action steps require: config.type

**ENTITY PROCESSING PATTERN:**
Use workflow_processing_records (find_unprocessed → process → record_processed)
Reference: generalCustomerStatusAssessment, productRecommendationEmail`,
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
      const { organizationId, threadId: currentThreadId } = ctx;

      // Look up parent thread from thread summary (stable, database-backed)
      // This ensures approvals from sub-agents link to the main chat thread
      const threadId = await getApprovalThreadId(ctx, currentThreadId);

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
          internal.agent_tools.workflows.internal_mutations
            .createWorkflowCreationApproval,
          {
            organizationId,
            workflowName: args.workflowConfig.name,
            workflowDescription: args.workflowConfig.description,
            workflowConfig: {
              ...args.workflowConfig,
              config: args.workflowConfig.config as Record<string, string | number | boolean | null> | undefined,
            },
            stepsConfig: args.stepsConfig.map(step => ({
              ...step,
              config: step.config as Record<string, string | number | boolean | null>,
            })),
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
