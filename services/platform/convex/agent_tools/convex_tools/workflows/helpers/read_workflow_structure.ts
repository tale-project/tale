import type { ActionCtx } from '../../../../_generated/server';
import type { Doc, Id } from '../../../../_generated/dataModel';
import { internal } from '../../../../_generated/api';
import type { WorkflowReadGetStructureResult } from './types';

export async function readWorkflowStructure(
  ctx: unknown,
  args: { workflowId: string },
): Promise<WorkflowReadGetStructureResult> {
  const actionCtx = ctx as ActionCtx;
  const workflowId = args.workflowId as Id<'wfDefinitions'>;

  const workflow = await actionCtx.runQuery(
    internal.wf_definitions.getWorkflow,
    {
      wfDefinitionId: workflowId,
    },
  );

  if (!workflow) {
    return { operation: 'get_structure', workflow: null, steps: [] };
  }

  const steps = await actionCtx.runQuery(
    internal.wf_step_defs.listWorkflowSteps,
    {
      wfDefinitionId: workflowId,
    },
  );

  return {
    operation: 'get_structure',
    workflow: workflow as Doc<'wfDefinitions'>,
    steps: steps as Doc<'wfStepDefs'>[],
  };
}
