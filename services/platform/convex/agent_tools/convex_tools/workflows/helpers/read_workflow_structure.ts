import type { ToolCtx } from '@convex-dev/agent';
import type { Doc, Id } from '../../../../_generated/dataModel';
import { internal } from '../../../../_generated/api';
import type { WorkflowReadGetStructureResult } from './types';

export async function readWorkflowStructure(
  ctx: ToolCtx,
  args: { workflowId: string },
): Promise<WorkflowReadGetStructureResult> {
  const workflowId = args.workflowId as Id<'wfDefinitions'>;

  const workflow = await ctx.runQuery(internal.wf_definitions.getWorkflow, {
    wfDefinitionId: workflowId,
  });

  if (!workflow) {
    return { operation: 'get_structure', workflow: null, steps: [] };
  }

  const steps = await ctx.runQuery(internal.wf_step_defs.listWorkflowSteps, {
    wfDefinitionId: workflowId,
  });

  return {
    operation: 'get_structure',
    workflow: workflow as Doc<'wfDefinitions'>,
    steps: steps as Doc<'wfStepDefs'>[],
  };
}
