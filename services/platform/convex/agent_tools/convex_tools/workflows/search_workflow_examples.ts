/**
 * Search Workflow Examples Tool
 *
 * Searches existing workflows to find examples and learn patterns.
 * Helps the AI understand how similar workflows are structured.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { internal } from '../../../_generated/api';
import type { Doc } from '../../../_generated/dataModel';

export const searchWorkflowExamplesTool = {
  name: 'search_workflow_examples' as const,
  tool: createTool({
    description:
      'Search for existing workflow examples by name, description, or purpose. Returns workflow definitions and their steps (including full configs) so you can learn from existing examples and reuse patterns. Use this before creating new workflows to find similar examples.',
    args: z.object({
      query: z
        .string()
        .describe(
          'Search query - keywords to find in workflow name or description (e.g., "product recommendations", "email automation", "customer engagement")',
        ),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe('Maximum number of examples to return (default: 5)'),
      includeInactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include inactive/draft workflows in results'),
    }),
    handler: async (ctx, args) => {
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        return {
          examples: [],
          message:
            'No organizationId in context - cannot search workflows. This tool requires organizationId to be set.',
        };
      }

      try {
        // Get all workflows for the organization
        const allWorkflows = (await ctx.runQuery(
          internal.wf_definitions.listWorkflows,
          {
            organizationId,
          },
        )) as Doc<'wfDefinitions'>[];

        // Filter by status if needed
        const workflows = args.includeInactive
          ? allWorkflows
          : allWorkflows.filter((wf) => wf.status === 'active');

        // Search by query in name and description
        const queryLower = args.query.toLowerCase();
        const matchingWorkflows = workflows.filter((wf) => {
          const nameLower = wf.name.toLowerCase();
          const descLower = (wf.description || '').toLowerCase();
          return (
            nameLower.includes(queryLower) || descLower.includes(queryLower)
          );
        });

        // Get steps for each matching workflow
        const examples = await Promise.all(
          matchingWorkflows.slice(0, args.limit).map(async (wf) => {
            const steps = (await ctx.runQuery(
              internal.wf_step_defs.listWorkflowSteps,
              {
                wfDefinitionId: wf._id,
              },
            )) as Doc<'wfStepDefs'>[];

            // Sort steps by order and return them directly
            const sortedSteps = steps.sort((a, b) => a.order - b.order);

            return {
              workflowId: wf._id,
              name: wf.name,
              description: wf.description || 'No description',
              status: wf.status,
              stepCount: steps.length,
              steps: sortedSteps,
            };
          }),
        );

        return {
          totalFound: matchingWorkflows.length,
          returned: examples.length,
          examples,
          suggestion:
            examples.length === 0
              ? `No workflows found matching "${args.query}". Try broader search terms or use list_available_actions to see what actions are available.`
              : `Found ${examples.length} example(s). Study the step structure to create similar workflows.`,
        };
      } catch (error) {
        return {
          examples: [],
          error: `Failed to search workflows: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
