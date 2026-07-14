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
import { readAllWorkflows } from './helpers/read_all_workflows';
import { readWorkflowStructure } from './helpers/read_workflow_structure';
import type {
  WorkflowReadGetStructureResult,
  WorkflowReadListAllResult,
} from './helpers/types';

const workflowReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_structure'),
    workflowSlug: z
      .string()
      .describe(
        "The workflow slug — the owning automation's slug, a '/'-separated path (e.g., \"imap-smtp/sync-emails\"). Use list_all to find available slugs.",
      ),
  }),
  z.object({
    operation: z.literal('list_all'),
  }),
]);

export const workflowReadTool: ToolDefinition = {
  name: 'workflow_read',
  availability: 'any',
  tool: createTool({
    description: `Workflow read tool for retrieving workflow information. A workflow lives inline in its owning automation's manifest — its slug IS the automation's slug.

OPERATIONS:
• 'get_structure': Get the complete structure of a workflow including all steps and configuration. Use this to understand the current workflow before making modifications. Takes a workflowSlug parameter.
• 'list_all': List all installed workflows for the organization. Returns workflow summaries (slug, name, description, version, stepCount). Use this to get an overview of all available workflows.

BEST PRACTICES:
• Use 'list_all' to get an overview of all workflows in the organization.
• Use 'get_structure' when you have a workflow slug and need to inspect or modify it.
• A workflow slug IS its automation's slug: a '/'-separated path of lowercase, hyphenated segments naming where the automation is filed (e.g., "imap-smtp/sync-emails", "projects/tasks/run-assigned").
• Each workflow definition contains all steps inline — there are no separate step records.`,
    inputSchema: workflowReadArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<WorkflowReadGetStructureResult | WorkflowReadListAllResult> => {
      const { organizationId } = ctx;
      if (!organizationId) {
        if (args.operation === 'get_structure') {
          return {
            operation: 'get_structure',
            slug: args.workflowSlug,
            config: null,
            error:
              'organizationId is required in the tool context to read a workflow.',
          };
        }
        return {
          operation: 'list_all',
          totalWorkflows: 0,
          workflows: [],
          error:
            'organizationId is required in the tool context to list workflows.',
        };
      }

      if (args.operation === 'get_structure') {
        return readWorkflowStructure(ctx, {
          workflowSlug: args.workflowSlug,
          organizationId,
        });
      }

      return readAllWorkflows(ctx, {});
    },
  }),
} as const;
