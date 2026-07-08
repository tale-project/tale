/**
 * Convex Tool: Create Workflow with Approval
 *
 * Creates a new workflow definition with all steps.
 * Requires user approval before the workflow is actually created.
 * This enables AI to propose workflows in chat that users can review and approve.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import { validateWorkflowDefinition } from '../../workflow_engine/helpers/validation/validate_workflow_definition';
import type { ToolDefinition } from '../types';
import {
  stepConfigSchema,
  workflowConfigSchema,
} from './helpers/workflow_definition_schema';

export const createWorkflowTool = {
  name: 'create_workflow' as const,
  availability: 'any' as const,
  tool: createTool({
    description: `Create a new workflow definition with all steps.
Requires user approval — an approval card rendered separately by the UI will be created. When telling the user the card is ready, only say it has been created — never describe where it appears, how to find it, or its direction relative to the chat (no "above"/"below"/"上方"/"下方"/"oben"/"unten"/equivalents).

**⭐ IF THE USER PROVIDED A WORKFLOW JSON CONFIG:**
Use the provided configuration DIRECTLY — do NOT recreate or rewrite it.
Map the JSON to this tool's schema: top-level fields → workflowConfig, steps array → stepsConfig.`,
    inputSchema: z.object({
      workflowConfig: workflowConfigSchema,
      stepsConfig: z
        .array(stepConfigSchema)
        .describe('Complete list of steps for this workflow.'),
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
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for workflow "${args.workflowConfig.name}". The user must approve this workflow creation before it will be created. Do NOT include suggested follow-ups or next steps — the user needs to act on the approval card first.`,
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
