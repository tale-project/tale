/**
 * Convex Tool: Save or Update Workflow Definition
 *
 * Saves a complete workflow definition (metadata + all steps) in one atomic operation.
 * If a workflow with the same name already exists for the organization, it will be updated
 * and all existing steps will be replaced with the provided steps.
 *
 * Includes built-in validation that checks:
 * - Valid stepTypes (start, llm, action, condition, loop)
 * - Required fields for each step type
 * - Valid nextSteps references
 * - Config structure for each step type
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { Id } from '../../_generated/dataModel';
import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { validateWorkflowDefinition } from '../../workflow_engine/helpers/validation/validate_workflow_definition';

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
    .enum(['start', 'llm', 'action', 'condition', 'loop'])
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

export const saveWorkflowDefinitionTool = {
  name: 'save_workflow_definition' as const,
  tool: createTool({
    description: `Save or update an entire workflow definition (metadata + all steps) in one atomic operation.

**WHEN TO USE:**
- Use this when you need to replace ALL steps for an existing workflow
- For single step updates, use update_workflow_step instead (more efficient)

**REQUIRED WORKFLOW:**
1. Call workflow_examples(operation='get_syntax_reference') to get syntax documentation
2. Call workflow_examples(operation='get_predefined') to study similar workflows
3. Build your workflow config and steps following the patterns
4. Call this tool with complete workflow definition

**STEP STRUCTURE:**
Each step requires: stepSlug, name, stepType, order, config, nextSteps
- stepSlug: snake_case unique identifier (e.g., "find_customers")
- stepType: start | llm | action | condition | loop
- config: Configuration object (varies by stepType)
- nextSteps: Route to next steps (e.g., {success: "next_step", failure: "error"})

**KEY PATTERNS:**
- Entity Processing: start -> find_unprocessed -> condition -> process -> record_processed
- Email Sending: See workflow_examples(operation='get_syntax_reference', category='email')
- Use 'noop' in nextSteps to gracefully end workflow

**VALIDATION:**
Built-in validation checks stepTypes, required fields, and nextSteps references.`,
    args: z.object({
      workflowConfig: workflowConfigSchema,
      stepsConfig: z
        .array(stepConfigSchema)
        .describe(
          'Complete list of steps for this workflow; existing steps will be replaced.',
        ),
      workflowId: z
        .string()
        .optional()
        .describe(
          'ID of an existing draft workflow to update. When omitted, the tool will use the workflowId from context; if neither is available, the call will fail. This tool never creates a new workflow.',
        ),
    }),
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      workflowId?: string;
      stepCount?: number;
      message: string;
      validationErrors?: string[];
      validationWarnings?: string[];
    }> => {
      const { organizationId, workflowId: workflowIdFromContext } = ctx;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to save a workflow definition.',
        };
      }

      const targetWorkflowId = args.workflowId ?? workflowIdFromContext;

      if (!targetWorkflowId) {
        return {
          success: false,
          message:
            'workflowId is required to save a workflow definition. This tool only updates existing draft workflows. Ensure it is attached to an automation or provide workflowId explicitly.',
        };
      }

      // Validate workflow definition before saving
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

      // Drop unsupported fields from workflowConfig before calling Convex
      const mutationArgs: {
        organizationId: string;
        workflowConfig: {
          description?: string;
          version?: string;
          workflowType?: 'predefined';
          config?: Record<string, unknown>;
        };
        stepsConfig: typeof args.stepsConfig;
        workflowId: Id<'wfDefinitions'>;
      } = {
        organizationId,
        workflowConfig: {
          description: args.workflowConfig.description,
          version: args.workflowConfig.version,
          workflowType: args.workflowConfig.workflowType,
          config: args.workflowConfig.config,
        },
        stepsConfig: args.stepsConfig,
        workflowId: targetWorkflowId as Id<'wfDefinitions'>,
      };

      try {
        const result = await ctx.runMutation(
          internal.wf_definitions.internal_mutations.saveWorkflowWithSteps,
          mutationArgs,
        );

        return {
          success: true,
          workflowId: result.workflowId as string,
          stepCount: args.stepsConfig.length,
          message: `Updated workflow "${args.workflowConfig.name}" with ${args.stepsConfig.length} steps (replaced existing steps)`,
          validationWarnings:
            validation.warnings.length > 0 ? validation.warnings : undefined,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to save workflow definition: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
