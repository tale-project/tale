/**
 * Set or update the component workflow id for an execution
 */

import type { MutationCtx } from '../../_generated/server';
import type { SetComponentWorkflowArgs } from './types';

export async function setComponentWorkflow(
  ctx: MutationCtx,
  args: SetComponentWorkflowArgs,
): Promise<null> {
  await ctx.db.patch(args.executionId, {
    componentWorkflowId: args.componentWorkflowId,
    updatedAt: Date.now(),
  });
  return null;
}
