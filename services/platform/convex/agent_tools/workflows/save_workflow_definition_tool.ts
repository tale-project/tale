/**
 * Convex Tool: Save or Update Workflow Definition
 *
 * Saves a complete workflow definition (metadata + all steps) in one atomic operation.
 * Requires user approval before the changes are applied.
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

import type { WorkflowJsonConfig } from '../../../lib/shared/schemas/workflows';
import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
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
    .describe('Optional version label, e.g. "1.0.0", "2.0.0".'),
  workflowType: z
    .enum(['predefined'])
    .optional()
    .describe('Workflow type; currently only "predefined" is supported.'),
  config: z
    .object({
      timeout: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'Workflow timeout in milliseconds (e.g., 120000 for 2 minutes).',
        ),
      retryPolicy: z
        .object({
          maxRetries: z
            .number()
            .int()
            .nonnegative()
            .describe('Maximum retry attempts.'),
          backoffMs: z
            .number()
            .int()
            .nonnegative()
            .describe('Backoff delay between retries in ms.'),
        })
        .optional()
        .describe('Default retry policy for action steps.'),
      variables: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Initial workflow-level variables accessible to all steps via {{config.variableName}}. organizationId is auto-injected.',
        ),
    })
    .optional()
    .describe(
      'Workflow-level configuration: timeout, retryPolicy, and initial variables.',
    ),
});

const stepConfigSchema = z.object({
  stepSlug: z
    .string()
    .describe('Unique step slug in snake_case (e.g., "find_customers").'),
  name: z
    .string()
    .describe('Human-readable step name (e.g., "Find Inactive Customers").'),
  stepType: z
    .enum(['start', 'llm', 'action', 'condition', 'loop', 'output'])
    .describe('Step type.'),
  config: z
    .record(z.string(), z.unknown())
    .describe('Step configuration object; structure depends on step type.'),
  nextSteps: z
    .record(z.string(), z.string())
    .describe(
      'Next step connections (e.g., {success: "next_step_id", failure: "error_handler"}).',
    ),
});

const DEFAULT_ORG_SLUG = 'default';

export const saveWorkflowDefinitionTool = {
  name: 'save_workflow_definition' as const,
  tool: createTool({
    description: `Save or update an entire workflow definition (metadata + all steps) in one atomic operation.
Requires user approval — an approval card will be created for the user to review and confirm.

**WHEN TO USE:**
- Use this when you need to replace ALL steps for an existing workflow
- For single step updates, use update_workflow_step instead (more efficient)

**⭐ IF THE USER PROVIDED A WORKFLOW JSON CONFIG:**
Use the provided configuration DIRECTLY — do NOT recreate or rewrite it.
Map the JSON to this tool's schema: top-level fields → workflowConfig, steps array → stepsConfig.

**APPROVAL:**
When this tool returns { requiresApproval: true }, do NOT call this tool again.
Inform the user the update is ready for review in the chat UI.`,
    inputSchema: z.object({
      workflowConfig: workflowConfigSchema,
      stepsConfig: z
        .array(stepConfigSchema)
        .describe(
          'Complete list of steps for this workflow; existing steps will be replaced.',
        ),
      workflowSlug: z
        .string()
        .describe(
          'Slug of the workflow to update (e.g., "conversation-sync", "circuly/sync-customers"). Required.',
        ),
      updateSummary: z
        .string()
        .describe(
          'Markdown-formatted summary of changes. Use bullet points for multiple changes. Example:\n- Added error handling step after API call\n- Updated email template with dynamic subject line',
        ),
    }),
    execute: async (
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
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to save a workflow definition.',
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

      // Read workflow file to verify it exists and get current metadata
      const readResult: { ok: boolean; config?: WorkflowJsonConfig } =
        await ctx.runAction(
          internal.workflows.file_actions.readWorkflowForExecution,
          {
            orgSlug: DEFAULT_ORG_SLUG,
            workflowSlug: args.workflowSlug,
          },
        );

      if (!readResult.ok || !readResult.config) {
        return {
          success: false,
          message: `Workflow "${args.workflowSlug}" not found. The file may have been deleted or moved.`,
        };
      }

      const currentConfig = readResult.config;

      try {
        const approvalId = await ctx.runMutation(
          internal.agent_tools.workflows.internal_mutations
            .createWorkflowUpdateApproval,
          {
            organizationId,
            workflowSlug: args.workflowSlug,
            workflowName: currentConfig.name,
            workflowVersion: currentConfig.version ?? '1.0.0',
            updateSummary: args.updateSummary,
            workflowConfig: {
              ...args.workflowConfig,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Zod-validated config is Record<string, unknown> but TS infers broader z.object type
              config: args.workflowConfig.config as
                | Record<string, unknown>
                | undefined,
            },
            stepsConfig: args.stepsConfig.map((step) => ({
              ...step,
              config: step.config,
            })),
            threadId,
            messageId,
          },
        );

        return {
          success: true,
          requiresApproval: true,
          approvalId,
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for updating workflow "${currentConfig.name}". The user must approve this update before changes will be applied.`,
          message: `Workflow update for "${currentConfig.name}" is ready for approval. An approval card has been created. Changes will be applied once the user approves it.`,
          validationWarnings:
            validation.warnings.length > 0 ? validation.warnings : undefined,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create workflow update approval: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
