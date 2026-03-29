/**
 * Convex Tool: Run Workflow with Approval
 *
 * Triggers execution of an existing file-based workflow definition.
 * Requires user approval before the workflow is actually started.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { WorkflowJsonConfig } from '../../../lib/shared/schemas/workflows';
import type { ToolDefinition } from '../types';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import { validateWorkflowInput } from '../../workflow_engine/helpers/validation/validate_workflow_input';
import { extractInputSchema } from './helpers/extract_input_schema';

const DEFAULT_ORG_SLUG = 'default';

const runWorkflowArgs = z.object({
  workflowSlug: z
    .string()
    .min(1)
    .describe(
      'The slug of the workflow to execute (e.g., "conversation-sync"). Use workflow_read(operation="list_all") to find available workflows.',
    ),
  // WORKAROUND: Use z.string() instead of z.record(z.string(), z.unknown()).
  // The AI SDK's addAdditionalPropertiesToJsonSchema() post-processing
  // unconditionally sets `additionalProperties: false` on all JSON Schema
  // objects (for OpenAI strict mode compatibility). This converts z.record()
  // into { type: "object", additionalProperties: false } — an empty object
  // that accepts no properties — causing the LLM to silently ignore the field.
  // Using z.string() produces { type: "string" } which survives post-processing.
  // The handler JSON.parse()s the string back into a record.
  // See: @ai-sdk/provider-utils/src/add-additional-properties-to-json-schema.ts
  parameters: z
    .string()
    .optional()
    .describe(
      'Optional input parameters as a JSON string. Example: \'{"targetFolder": "/invoices", "daysBack": 30}\'. Keys become variable names accessible to all steps via {{variableName}}.',
    ),
});

export { runWorkflowArgs };

export const runWorkflowTool = {
  name: 'run_workflow' as const,
  tool: createTool({
    description: `Trigger execution of an existing file-based workflow definition.

**WHEN TO USE:**
• Use this tool to run/execute a workflow that has already been created
• First use workflow_read(operation="list_all") to find the workflow slug
• Use workflow_read(operation="get_structure") to understand expected input parameters

**DO NOT USE THIS TOOL FOR:**
• Creating new workflows — use create_workflow instead
• Reading workflow details — use workflow_read instead
• Updating workflow steps — use update_workflow_step instead

**APPROVAL REQUIRED:**
This tool creates an approval card. The user must click "Run Workflow" to confirm execution. The workflow will NOT start until approved.

**PARAMETERS:**
• workflowSlug (required): The workflow file slug (e.g., "conversation-sync")
• parameters (optional): JSON string of input variables for the workflow

**EXAMPLE:**
{ "workflowSlug": "conversation-sync", "parameters": "{\\"targetFolder\\": \\"/invoices\\", \\"daysBack\\": 30}" }`,
    inputSchema: runWorkflowArgs,
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
    }> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to run a workflow.',
        };
      }

      const result: unknown = await ctx.runAction(
        internal.workflows.file_actions.readWorkflowForExecution,
        { orgSlug: DEFAULT_ORG_SLUG, workflowSlug: args.workflowSlug },
      );

      if (!isRecord(result) || result.ok !== true) {
        const msg =
          isRecord(result) && typeof result.message === 'string'
            ? result.message
            : `Workflow "${args.workflowSlug}" not found.`;
        return { success: false, message: msg };
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readWorkflowForExecution returns v.any() but ok=true guarantees WorkflowJsonConfig
      const config = result.config as WorkflowJsonConfig;

      if (!config.enabled) {
        return {
          success: false,
          message: `Workflow "${config.name}" is disabled and cannot be executed. Enable it first.`,
        };
      }

      let parsedParameters: Record<string, unknown> | undefined;
      if (args.parameters) {
        try {
          parsedParameters = JSON.parse(args.parameters);
        } catch {
          return {
            success: false,
            message:
              'Invalid parameters: expected a valid JSON string. Example: \'{"key": "value"}\'',
          };
        }
      }

      const startStep = config.steps.find((s) => s.stepType === 'start');
      const inputSchema = extractInputSchema(startStep?.config);
      const validation = validateWorkflowInput(parsedParameters, inputSchema);

      if (!validation.valid) {
        return {
          success: false,
          message: `Invalid workflow parameters: ${validation.errors.join('; ')}. Use workflow_read(operation="get_structure") to check the expected input schema.`,
        };
      }

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      try {
        const approvalId = await ctx.runMutation(
          internal.agent_tools.workflows.internal_mutations
            .createWorkflowRunApproval,
          {
            organizationId,
            workflowSlug: args.workflowSlug,
            workflowName: config.name,
            workflowDescription: config.description,
            parameters: parsedParameters,
            threadId,
            messageId,
          },
        );

        return {
          success: true,
          requiresApproval: true,
          approvalId,
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created to run workflow "${config.name}". The user must approve this before execution begins.`,
          message: `Workflow "${config.name}" is ready to run. An approval card has been created. The workflow will start once the user approves it.`,
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
