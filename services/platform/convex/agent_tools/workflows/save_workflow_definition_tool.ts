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

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
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
    .describe('Optional version label, e.g. "v1", "v2".'),
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
          'Initial workflow-level variables accessible to all steps via {{variableName}}. organizationId is auto-injected.',
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
Skip calling workflow_examples; only use it when building a workflow from scratch.

**IF BUILDING FROM SCRATCH:**
1. Call workflow_examples(operation='get_syntax_reference') to get syntax documentation
2. Build your workflow config and steps following the patterns
3. Call this tool with complete workflow definition

**STEP STRUCTURE:**
Each step requires: stepSlug, name, stepType, config, nextSteps (order is auto-computed)
- stepSlug: snake_case unique identifier (e.g., "find_customers")
- stepType: start | llm | action | condition | loop | output
- config: Configuration object (varies by stepType)
- nextSteps: Route to next steps (e.g., {success: "next_step", failure: "error"})

**KEY PATTERNS:**
- Entity Processing: start -> find_unprocessed -> condition -> process -> record_processed
- Email Sending: See workflow_examples(operation='get_syntax_reference', category='email')
- Use 'noop' in nextSteps to gracefully end workflow

**VALIDATION:**
Built-in validation checks stepTypes, required fields, and nextSteps references.

**APPROVAL:**
When this tool returns { requiresApproval: true }, do NOT call this tool again.
Inform the user the update is ready for review in the chat UI.`,
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
      updateSummary: z
        .string()
        .describe(
          'Markdown-formatted summary of changes. Use bullet points for multiple changes. Example:\n- Added error handling step after API call\n- Updated email template with dynamic subject line',
        ),
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
      const {
        organizationId,
        workflowId: workflowIdFromContext,
        threadId: currentThreadId,
        messageId,
      } = ctx;

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

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

      // Resolve workflow name and version for the approval card
      const workflow = await ctx.runQuery(
        internal.wf_definitions.internal_queries.resolveWorkflow,
        { wfDefinitionId: toId<'wfDefinitions'>(targetWorkflowId) },
      );

      if (!workflow) {
        return {
          success: false,
          message: `Workflow "${targetWorkflowId}" not found. It may have been deleted.`,
        };
      }

      try {
        const approvalId = await ctx.runMutation(
          internal.agent_tools.workflows.internal_mutations
            .createWorkflowUpdateApproval,
          {
            organizationId,
            workflowId: toId<'wfDefinitions'>(targetWorkflowId),
            workflowName: workflow.name,
            workflowVersionNumber: workflow.versionNumber,
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
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for updating workflow "${workflow.name}". The user must approve this update in the chat UI before changes will be applied.`,
          message: `Workflow update for "${workflow.name}" is ready for approval. An approval card has been created. Changes will be applied once the user approves it.`,
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
