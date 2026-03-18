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

import type { ToolDefinition } from '../types';
import type {
  WorkflowReadGetStructureResult,
  WorkflowReadListAllResult,
  WorkflowReadGetActiveVersionStepsResult,
  WorkflowReadListVersionHistoryResult,
} from './helpers/types';

import { workflowStatusSchema } from '../../../lib/shared/schemas/wf_definitions';
import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { readActiveVersionSteps } from './helpers/read_active_version_steps';
import { readAllWorkflows } from './helpers/read_all_workflows';
import { readVersionHistory } from './helpers/read_version_history';
import { readWorkflowStructure } from './helpers/read_workflow_structure';

const workflowReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_structure'),
    workflowId: z
      .string()
      .describe('The workflow ID (Convex Id<"wfDefinitions">)'),
  }),
  z.object({
    operation: z.literal('get_step'),
    stepId: z.string().describe('The step record ID (Convex Id<"wfStepDefs">)'),
  }),
  z.object({
    operation: z.literal('list_all'),
    status: workflowStatusSchema
      .optional()
      .describe(
        "Optional status filter ('draft', 'active', or 'archived'). If not provided, returns all workflows.",
      ),
    includeStepCount: z
      .boolean()
      .optional()
      .describe(
        'Whether to include step count for each workflow (default: false). Setting to true may increase response time.',
      ),
  }),
  z.object({
    operation: z.literal('get_active_version_steps'),
    workflowName: z
      .string()
      .describe('The workflow name to look up versions for'),
  }),
  z.object({
    operation: z.literal('list_version_history'),
    workflowName: z.string().describe('The workflow name'),
    includeSteps: z
      .boolean()
      .optional()
      .describe(
        'Whether to include all steps for each version (default: false). Setting to true may increase response time significantly.',
      ),
  }),
]);

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
        return readWorkflowStructure(ctx, { workflowId: args.workflowId });
      }

      if (args.operation === 'get_step') {
        const stepDoc = await ctx.runQuery(
          internal.wf_step_defs.internal_queries.getStepById,
          {
            stepId: toId<'wfStepDefs'>(args.stepId),
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
        return readActiveVersionSteps(ctx, { workflowName: args.workflowName });
      }

      if (args.operation === 'list_version_history') {
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
