/**
 * Helper to read the active version of a workflow with all its steps
 */

import type { ActionCtx } from '../../../../_generated/server';
import type { Doc } from '../../../../_generated/dataModel';
import { internal } from '../../../../_generated/api';
import type { WorkflowReadGetActiveVersionStepsResult } from './types';

export interface ReadActiveVersionStepsArgs {
  workflowName: string;
}

export async function readActiveVersionSteps(
  ctx: unknown,
  args: ReadActiveVersionStepsArgs,
): Promise<WorkflowReadGetActiveVersionStepsResult> {
  const actionCtx = ctx as ActionCtx;
  const organizationId = (ctx as unknown as { organizationId?: string })
    .organizationId;

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
    const workflow = (await actionCtx.runQuery(
      internal.wf_definitions.getActiveVersion,
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
    const steps = (await actionCtx.runQuery(
      internal.wf_step_defs.listWorkflowSteps,
      {
        wfDefinitionId: workflow._id,
      },
    )) as Doc<'wfStepDefs'>[];

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

