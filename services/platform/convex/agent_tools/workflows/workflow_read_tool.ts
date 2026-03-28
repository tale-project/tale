/**
 * Convex Tool: Workflow Read
 *
 * Unified read-only workflow operations for agents.
 * Supports:
 * - operation = 'get_structure': fetch workflow config with all steps by slug
 * - operation = 'list_all': list all workflows for the organization
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import type {
  WorkflowReadGetStructureResult,
  WorkflowReadListAllResult,
} from './helpers/types';

import { readAllWorkflows } from './helpers/read_all_workflows';
import { readWorkflowStructure } from './helpers/read_workflow_structure';

const workflowReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_structure'),
    workflowSlug: z
      .string()
      .describe(
        'The workflow slug (e.g., "conversation-sync" or "general/my-workflow"). Use list_all to find available slugs.',
      ),
  }),
  z.object({
    operation: z.literal('list_all'),
    enabledOnly: z
      .boolean()
      .optional()
      .describe(
        'If true, only return enabled workflows (default: false, returns all).',
      ),
  }),
]);

export const workflowReadTool: ToolDefinition = {
  name: 'workflow_read',
  tool: createTool({
    description: `Workflow read tool for retrieving workflow information from file-based workflow definitions.

OPERATIONS:
• 'get_structure': Get the complete structure of a workflow including all steps and configuration. Use this to understand the current workflow before making modifications. Takes a workflowSlug parameter.
• 'list_all': List all workflows for the organization. Returns workflow summaries (slug, name, description, enabled, version, stepCount). Use this to get an overview of all available workflows.

BEST PRACTICES:
• Use 'list_all' to get an overview of all workflows in the organization.
• Use 'get_structure' when you have a workflow slug and need to inspect or modify it.
• Workflow slugs are lowercase with hyphens/underscores (e.g., "conversation-sync", "general/my-workflow").
• Each workflow file contains all steps inline — there are no separate step records.`,
    inputSchema: workflowReadArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<WorkflowReadGetStructureResult | WorkflowReadListAllResult> => {
      if (args.operation === 'get_structure') {
        return readWorkflowStructure(ctx, {
          workflowSlug: args.workflowSlug,
        });
      }

      return readAllWorkflows(ctx, {
        enabledOnly: args.enabledOnly,
      });
    },
  }),
} as const;
