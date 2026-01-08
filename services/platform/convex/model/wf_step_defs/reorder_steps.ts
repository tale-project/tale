/**
 * Reorder steps
 */

import type { MutationCtx } from '../../_generated/server';
import type { ReorderStepsArgs } from './types';

export async function reorderSteps(
  ctx: MutationCtx,
  args: ReorderStepsArgs,
): Promise<null> {
  await Promise.all(
    args.stepOrders.map(({ stepRecordId, newOrder }) =>
      ctx.db.patch(stepRecordId, { order: newOrder }),
    ),
  );
  return null;
}

