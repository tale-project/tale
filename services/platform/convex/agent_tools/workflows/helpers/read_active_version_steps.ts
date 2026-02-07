/**
 * Helper to read the active version of a workflow with all its steps
 */

import type { ToolCtx } from '@convex-dev/agent';
import type { Doc } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';
import type { WorkflowReadGetActiveVersionStepsResult } from './types';

export interface ReadActiveVersionStepsArgs {
  workflowName: string;
}

export async function readActiveVersionSteps(
  ctx: ToolCtx,
  args: ReadActiveVersionStepsArgs,
): Promise<WorkflowReadGetActiveVersionStepsResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    return {
      operation: 'get_active_version_steps',
      workflow: null,
      steps: [],
      message:
        'No organizationId in context - cannot get active version steps. This tool requires organizationId to be set.',
    };
  }

  try {
    // Get the active version of the workflow
    const workflow = (await ctx.runQuery(
      internal.wf_definitions.internal_queries.getActiveVersion,
      {
        organizationId,
        name: args.workflowName,
      },
    )) as Doc<'wfDefinitions'> | null;

    if (!workflow) {
      return {
        operation: 'get_active_version_steps',
        workflow: null,
        steps: [],
        message: `No active version found for workflow "${args.workflowName}".`,
      };
    }

    // Get all steps for the active workflow version
    const steps = (await ctx.runQuery(internal.wf_step_defs.internal_queries.listWorkflowSteps, {
      wfDefinitionId: workflow._id,
    })) as Doc<'wfStepDefs'>[];

    return {
      operation: 'get_active_version_steps',
      workflow,
      steps,
      message: `Found active version "${workflow.version}" with ${steps.length} step(s).`,
    };
  } catch (error) {
    return {
      operation: 'get_active_version_steps',
      workflow: null,
      steps: [],
      error: `Failed to get active version steps: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}
