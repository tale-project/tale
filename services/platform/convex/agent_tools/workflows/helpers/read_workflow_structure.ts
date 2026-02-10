import type { ToolCtx } from '@convex-dev/agent';

import type { WorkflowReadGetStructureResult } from './types';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';

export async function readWorkflowStructure(
  ctx: ToolCtx,
  args: { workflowId: string },
): Promise<WorkflowReadGetStructureResult> {
  const wfDefinitionId = toId<'wfDefinitions'>(args.workflowId);

  const workflow = await ctx.runQuery(
    internal.wf_definitions.internal_queries.resolveWorkflow,
    {
      wfDefinitionId,
    },
  );

  if (!workflow) {
    return { operation: 'get_structure', workflow: null, steps: [] };
  }

  const steps = await ctx.runQuery(
    internal.wf_step_defs.internal_queries.listWorkflowSteps,
    {
      wfDefinitionId,
    },
  );

  return {
    operation: 'get_structure',
    workflow: workflow,
    steps: steps,
  };
}
