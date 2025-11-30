/**
 * Update workflow status
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export interface UpdateWorkflowStatusArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  status: string;
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

