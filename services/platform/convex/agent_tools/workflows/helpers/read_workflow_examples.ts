import type { ToolCtx } from '@convex-dev/agent';

import type { WorkflowReadSearchExamplesResult } from './types';

import { internal } from '../../../_generated/api';

export async function readWorkflowExamples(
  ctx: ToolCtx,
  args: { query: string; limit?: number; includeInactive?: boolean },
): Promise<WorkflowReadSearchExamplesResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    return {
      operation: 'search_examples',
      totalFound: 0,
      returned: 0,
      examples: [],
      suggestion: '',
      message:
        'No organizationId in context - cannot search workflows. This tool requires organizationId to be set.',
    };
  }

  try {
    const allWorkflows = await ctx.runQuery(
      internal.wf_definitions.internal_queries.listWorkflows,
      {
        organizationId,
      },
    );

    const includeInactive = args.includeInactive ?? false;
    const workflows = includeInactive
      ? allWorkflows
      : allWorkflows.filter((wf) => wf.status === 'active');

    const queryLower = args.query.toLowerCase();
    const matchingWorkflows = workflows.filter((wf) => {
      const nameLower = wf.name.toLowerCase();
      const descLower = (wf.description || '').toLowerCase();
      return nameLower.includes(queryLower) || descLower.includes(queryLower);
    });

    const limit = args.limit ?? 5;

    const examples = await Promise.all(
      matchingWorkflows.slice(0, limit).map(async (wf) => {
        const steps = await ctx.runQuery(
          internal.wf_step_defs.internal_queries.listWorkflowSteps,
          {
            wfDefinitionId: wf._id,
          },
        );

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
      operation: 'search_examples',
      totalFound: matchingWorkflows.length,
      returned: examples.length,
      examples,
      suggestion:
        examples.length === 0
          ? `No workflows found matching "${args.query}". Try broader search terms.`
          : `Found ${examples.length} example(s). Study the step structure to create similar workflows.`,
    };
  } catch (error) {
    return {
      operation: 'search_examples',
      totalFound: 0,
      returned: 0,
      examples: [],
      suggestion: '',
      error: `Failed to search workflows: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}
