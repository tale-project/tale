/**
 * Convex Tool: Save or Update Workflow Definition
 *
 * Saves a complete workflow definition (metadata + all steps) in one atomic operation.
 * If a workflow with the same name already exists for the organization, it will be updated
 * and all existing steps will be replaced with the provided steps.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

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

export const saveWorkflowDefinitionTool = {
  name: 'save_workflow_definition' as const,
  tool: createTool({
    description:
      'Save or update an entire workflow definition (metadata + all steps) in one atomic operation. ' +
      'Use this when you have regenerated all steps for a workflow and want to replace any existing steps in the database. ' +
      'IMPORTANT: Before using this tool, ALWAYS call search_workflow_examples first to find similar workflows and copy their config structure to avoid schema validation errors. ' +
      'When the assistant is connected to a specific automation, it should prefer updating that draft workflow instead of creating a new one.',
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
      ctx,
      args,
    ): Promise<{
      success: boolean;
      workflowId?: string;
      stepCount?: number;
      message: string;
    }> => {
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error('organizationId is required in context');
      }

      const workflowIdFromContext = (ctx as unknown as { workflowId?: string })
        .workflowId;
      const targetWorkflowId = args.workflowId ?? workflowIdFromContext;

      if (!targetWorkflowId) {
        return {
          success: false,
          message:
            'workflowId is required to save a workflow definition. This tool only updates existing draft workflows. Ensure it is attached to an automation or provide workflowId explicitly.',
        } satisfies {
          success: boolean;
          workflowId?: string;
          stepCount?: number;
          message: string;
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
          internal.wf_definitions.saveWorkflowWithSteps,
          mutationArgs,
        );

        return {
          success: true,
          workflowId: result.workflowId as string,
          stepCount: args.stepsConfig.length,
          message: `Updated workflow "${args.workflowConfig.name}" with ${args.stepsConfig.length} steps (replaced existing steps)`,
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
