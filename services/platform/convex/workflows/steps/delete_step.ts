/**
 * Delete workflow step
 */

import type { MutationCtx } from '../../_generated/server';
import type { DeleteStepArgs } from './types';

export async function deleteStep(
  ctx: MutationCtx,
  args: DeleteStepArgs,
): Promise<null> {
  await ctx.db.delete(args.stepRecordId);
  return null;
}
