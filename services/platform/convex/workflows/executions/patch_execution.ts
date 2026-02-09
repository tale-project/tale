/**
 * Patch Execution
 *
 * Updates specific fields of a workflow execution record.
 */

import type { MutationCtx } from '../../_generated/server';
import type { PatchExecutionArgs } from './types';

export async function patchExecution(
  ctx: MutationCtx,
  args: PatchExecutionArgs,
): Promise<null> {
  const execution = await ctx.db.get(args.executionId);
  if (!execution) {
    throw new Error(`Execution ${args.executionId} not found`);
  }

  await ctx.db.patch(args.executionId, {
    ...args.updates,
    updatedAt: Date.now(),
  });

  return null;
}
