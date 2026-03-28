import type { ToolCtx } from '@convex-dev/agent';

import type { WorkflowReadListAllResult, WorkflowSummary } from './types';

import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';

const DEFAULT_ORG_SLUG = 'default';

export async function readAllWorkflows(
  ctx: ToolCtx,
  args: { enabledOnly?: boolean },
): Promise<WorkflowReadListAllResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    return {
      operation: 'list_all',
      totalWorkflows: 0,
      workflows: [],
      message:
        'No organizationId in context - cannot list workflows. This tool requires organizationId to be set.',
    };
  }

  try {
    const rawResults: unknown = await ctx.runAction(
      internal.workflows.file_actions.listWorkflowsForAgent,
      { orgSlug: DEFAULT_ORG_SLUG },
    );

    if (!Array.isArray(rawResults)) {
      return {
        operation: 'list_all',
        totalWorkflows: 0,
        workflows: [],
        message: 'No workflows found for this organization.',
      };
    }

    const workflows: WorkflowSummary[] = [];
    for (const item of rawResults) {
      if (!isRecord(item) || typeof item.slug !== 'string') continue;

      const enabled = typeof item.enabled === 'boolean' ? item.enabled : false;
      if (args.enabledOnly && !enabled) continue;

      workflows.push({
        slug: item.slug,
        name: typeof item.name === 'string' ? item.name : item.slug,
        description:
          typeof item.description === 'string' ? item.description : undefined,
        enabled,
        version: typeof item.version === 'string' ? item.version : undefined,
        stepCount:
          typeof item.stepCount === 'number' ? item.stepCount : undefined,
      });
    }

    return {
      operation: 'list_all',
      totalWorkflows: workflows.length,
      workflows,
      message:
        workflows.length === 0
          ? 'No workflows found for this organization.'
          : `Found ${workflows.length} workflow(s).`,
    };
  } catch (error) {
    return {
      operation: 'list_all',
      totalWorkflows: 0,
      workflows: [],
      error: `Failed to list workflows: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}
