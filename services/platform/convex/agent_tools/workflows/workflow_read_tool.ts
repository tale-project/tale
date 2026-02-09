/**
 * Convex Tool: Workflow Read
 *
 * Unified read-only workflow operations for agents.
 * Supports:
 * - operation = 'get_structure': fetch workflow structure with all steps
 * - operation = 'get_step': fetch a single step by ID
 * - operation = 'list_all': list all workflows for the organization
 * - operation = 'get_active_version_steps': get active version steps by workflow name
 * - operation = 'list_version_history': list all versions of a workflow
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { Id } from '../../_generated/dataModel';
import type { ToolDefinition } from '../types';
import type {
  WorkflowReadGetStructureResult,
  WorkflowReadListAllResult,
  WorkflowReadGetActiveVersionStepsResult,
  WorkflowReadListVersionHistoryResult,
} from './helpers/types';

import { internal } from '../../_generated/api';
import { readActiveVersionSteps } from './helpers/read_active_version_steps';
import { readAllWorkflows } from './helpers/read_all_workflows';
import { readVersionHistory } from './helpers/read_version_history';
import { readWorkflowStructure } from './helpers/read_workflow_structure';

// Use a flat object schema instead of discriminatedUnion to ensure OpenAI-compatible JSON Schema
// (discriminatedUnion produces anyOf/oneOf which some providers reject as "type: None")
const workflowReadArgs = z.object({
  operation: z
    .enum([
      'get_structure',
      'get_step',
      'list_all',
      'get_active_version_steps',
      'list_version_history',
    ])
    .describe(
      "Operation to perform: 'get_structure', 'get_step', 'list_all', 'get_active_version_steps', or 'list_version_history'",
    ),
  // For get_structure operation
  workflowId: z
    .string()
    .optional()
    .describe(
      'Required for \'get_structure\': The workflow ID (Convex Id<"wfDefinitions">)',
    ),
  // For get_step operation
  stepId: z
    .string()
    .optional()
    .describe(
      'Required for \'get_step\': The step record ID (Convex Id<"wfStepDefs">)',
    ),
  // For list_all operation
  status: z
    .string()
    .optional()
    .describe(
      "For 'list_all': Optional status filter ('draft', 'active', or 'archived'). If not provided, returns all workflows.",
    ),
  includeStepCount: z
    .boolean()
    .optional()
    .describe(
      "For 'list_all': Whether to include step count for each workflow (default: false). Setting to true may increase response time.",
    ),
  // For get_active_version_steps and list_version_history operations
  workflowName: z
    .string()
    .optional()
    .describe(
      "Required for 'get_active_version_steps' and 'list_version_history': The workflow name to look up versions for.",
    ),
  // For list_version_history operation
  includeSteps: z
    .boolean()
    .optional()
    .describe(
      "For 'list_version_history': Whether to include all steps for each version (default: false). Setting to true may increase response time significantly.",
    ),
});

export const workflowReadTool: ToolDefinition = {
  name: 'workflow_read',
  tool: createTool({
    description: `Workflow read tool for retrieving workflow information.

OPERATIONS:
• 'get_structure': Get the complete structure of a workflow including workflow metadata and all steps. Use this to understand the current workflow before making modifications.
• 'get_step': Get a single step by its ID. **Use this when you need to update a step's config** - it returns the complete current step config that you can modify and pass to update_workflow_step.
• 'list_all': List all workflows for the organization. Returns workflow summaries (id, name, description, status, version). Use this to get an overview of all available workflows.
• 'get_active_version_steps': Get the current active version of a workflow by name, including all its steps. Use this when you need to see what the currently deployed version looks like.
• 'list_version_history': List all versions of a workflow (draft, active, archived) with optional step details. Use this to review the version history and understand how a workflow has evolved.

BEST PRACTICES:
• Use 'list_all' to get an overview of all workflows in the organization.
• Use 'get_structure' when you have a specific workflow ID and need to inspect or modify it.
• **Use 'get_step' before calling update_workflow_step** - this gets the complete current config you need to modify.
• Use 'get_active_version_steps' when you need the currently active/deployed version by workflow name.
• Use 'list_version_history' to see all versions of a workflow and their changes over time.
• Pass 'status' parameter with 'list_all' to filter by workflow status.`,
    args: workflowReadArgs,
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<
      | WorkflowReadGetStructureResult
      | WorkflowReadListAllResult
      | WorkflowReadGetActiveVersionStepsResult
      | WorkflowReadListVersionHistoryResult
      | { success: boolean; step: unknown }
    > => {
      if (args.operation === 'get_structure') {
        if (!args.workflowId) {
          throw new Error(
            "Missing required 'workflowId' for get_structure operation",
          );
        }
        return readWorkflowStructure(ctx, { workflowId: args.workflowId });
      }

      if (args.operation === 'get_step') {
        if (!args.stepId) {
          throw new Error("Missing required 'stepId' for get_step operation");
        }
        // Get the step by ID using internal query
        const stepDoc = await ctx.runQuery(
          internal.wf_step_defs.internal_queries.getStepById,
          {
            stepId: args.stepId as Id<'wfStepDefs'>,
          },
        );
        if (!stepDoc) {
          throw new Error(`Step not found: ${args.stepId}`);
        }
        return {
          success: true,
          step: stepDoc,
        };
      }

      if (args.operation === 'get_active_version_steps') {
        if (!args.workflowName) {
          throw new Error(
            "Missing required 'workflowName' for get_active_version_steps operation",
          );
        }
        return readActiveVersionSteps(ctx, { workflowName: args.workflowName });
      }

      if (args.operation === 'list_version_history') {
        if (!args.workflowName) {
          throw new Error(
            "Missing required 'workflowName' for list_version_history operation",
          );
        }
        return readVersionHistory(ctx, {
          workflowName: args.workflowName,
          includeSteps: args.includeSteps,
        });
      }

      // operation === 'list_all'
      return readAllWorkflows(ctx, {
        status: args.status,
        includeStepCount: args.includeStepCount,
      });
    },
  }),
} as const;
