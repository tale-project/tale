/**
 * Update workflow status
 */

import type { WorkflowStatus } from '../../../lib/shared/schemas/wf_definitions';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export interface UpdateWorkflowStatusArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  status: WorkflowStatus;
  updatedBy: string;
}

export async function updateWorkflowStatus(
  ctx: MutationCtx,
  args: UpdateWorkflowStatusArgs,
): Promise<null> {
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error(`Workflow ${args.wfDefinitionId} not found`);
  }

  await ctx.db.patch(args.wfDefinitionId, {
    status: args.status,
    metadata: {
      ...workflow.metadata,
      updatedAt: Date.now(),
      updatedBy: args.updatedBy,
    },
  });

  return null;
}
