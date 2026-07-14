/**
 * Convex Tool: Create Workflow with Approval
 *
 * Proposes a new org AUTOMATION whose manifest carries the workflow inline —
 * a workflow only exists inside an automation (workflowSlug === automationSlug).
 * Requires user approval before anything is written; on approval the executor
 * (`internal_actions.ts#executeApprovedWorkflowCreation`) writes
 * `automations/<slug>/automation.json` and installs it through the standard
 * automation install pipeline.
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
    description: `Create a new workflow with all steps. It is created as an org automation carrying the workflow (the workflow's slug IS the automation's slug), visible under Automations.
Requires user approval — an approval card rendered separately by the UI will be created. When telling the user the card is ready, only say it has been created — never describe where it appears, how to find it, or its direction relative to the chat (no "above"/"below"/"上方"/"下方"/"oben"/"unten"/equivalents).

**⭐ IF THE USER PROVIDED A WORKFLOW JSON CONFIG:**
Use the provided configuration DIRECTLY — do NOT recreate or rewrite it.
Map the JSON to this tool's schema: top-level fields → workflowConfig, steps array → stepsConfig.`,
    inputSchema: z.object({
      workflowSlug: z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        .describe(
          'Unique kebab-case slug identifying the workflow AND the automation created to carry it — a \'/\'-separated PATH that also files the automation into a folder (e.g. "shopify/sync-customers", or a bare "my-automation" at the root; max 4 segments). Must not collide with an existing automation.',
        ),
      name: z
        .string()
        .min(1)
        .max(120)
        .describe(
          'Human-readable display name for the automation that will carry this workflow (shown in the Automations list).',
        ),
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
            // Display name of the automation created to carry the workflow —
            // approval cards label with it; the executor writes it into the
            // automation manifest's `name`.
            workflowName: args.name,
            workflowSlug: args.workflowSlug,
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
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for workflow "${args.workflowSlug}". The user must approve this workflow creation before it will be created. Do NOT include suggested follow-ups or next steps — the user needs to act on the approval card first.`,
          message: `Workflow "${args.workflowSlug}" is ready for approval. An approval card has been created. The workflow will be created once the user approves it.`,
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
