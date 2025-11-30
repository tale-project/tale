/**
 * Reorder steps
 */

import type { MutationCtx } from '../../_generated/server';
import type { ReorderStepsArgs } from './types';

export async function reorderSteps(
  ctx: MutationCtx,
  args: ReorderStepsArgs,
): Promise<null> {
  for (const { stepRecordId, newOrder } of args.stepOrders) {
    await ctx.db.patch(stepRecordId, { order: newOrder });
  }
  return null;
}

