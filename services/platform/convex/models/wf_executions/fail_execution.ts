/**
 * Fail execution
 */

import type { MutationCtx } from '../../_generated/server';
import type { FailExecutionArgs } from './types';

export async function failExecution(
  ctx: MutationCtx,
  args: FailExecutionArgs,
): Promise<null> {
  // Get current execution to clean up storage
  const execution = await ctx.db.get(args.executionId);
  const storageId = execution?.variablesStorageId;

  await ctx.db.patch(args.executionId, {
    status: 'failed',
    metadata: JSON.stringify({ error: args.error }),
    updatedAt: Date.now(),
  });

  // Clean up storage if it exists
  if (storageId) {
    await ctx.storage.delete(storageId);
  }

  return null;
}
