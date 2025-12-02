import type { ActionCtx } from '../../../../_generated/server';
import type { Doc } from '../../../../_generated/dataModel';
import { internal } from '../../../../_generated/api';
import type { WorkflowReadListAllResult, WorkflowSummary } from './types';

export interface ReadAllWorkflowsArgs {
  status?: string;
  includeStepCount?: boolean;
}

export async function readAllWorkflows(
  ctx: unknown,
  args: ReadAllWorkflowsArgs,
): Promise<WorkflowReadListAllResult> {
  const actionCtx = ctx as ActionCtx;
  const organizationId = (ctx as unknown as { organizationId?: string })
    .organizationId;

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
    const allWorkflows = (await actionCtx.runQuery(
      internal.wf_definitions.listWorkflows,
      {
        organizationId,
        status: args.status,
      },
    )) as Doc<'wfDefinitions'>[];

    const includeStepCount = args.includeStepCount ?? false;

    const workflows: WorkflowSummary[] = await Promise.all(
      allWorkflows.map(async (wf) => {
        let stepCount: number | undefined;

        if (includeStepCount) {
          const steps = (await actionCtx.runQuery(
            internal.wf_step_defs.listWorkflowSteps,
            {
              wfDefinitionId: wf._id,
            },
          )) as Doc<'wfStepDefs'>[];
          stepCount = steps.length;
        }

        return {
          workflowId: wf._id as string,
          name: wf.name,
          description: wf.description,
          status: wf.status,
          version: wf.version,
          versionNumber: wf.versionNumber,
          ...(stepCount !== undefined && { stepCount }),
        };
      }),
    );

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

