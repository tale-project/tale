/**
 * Persist execution output without changing status.
 *
 * Used by the serialize action to store output before the component callback
 * sets the terminal status.
 */

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { ConvexJsonValue } from '../../lib/validators/json';

import { internal } from '../../_generated/api';
import { INTERMEDIATE_STORAGE_RETENTION_MS } from './cleanup_execution_storage';

export interface PersistExecutionOutputArgs {
  executionId: Id<'wfExecutions'>;
  output: ConvexJsonValue;
  outputStorageId?: Id<'_storage'>;
}

export async function persistExecutionOutput(
  ctx: MutationCtx,
  args: PersistExecutionOutputArgs,
): Promise<null> {
  const execution = await ctx.db.get(args.executionId);
  if (!execution) return null;

  const oldOutputStorageId = execution.outputStorageId;

  await ctx.db.patch(execution._id, {
    output: args.output,
    outputStorageId: args.outputStorageId,
    updatedAt: Date.now(),
  });

  if (
    oldOutputStorageId &&
    (!args.outputStorageId || oldOutputStorageId !== args.outputStorageId)
  ) {
    await ctx.scheduler.runAfter(
      INTERMEDIATE_STORAGE_RETENTION_MS,
      internal.wf_executions.internal_mutations.deleteStorageBlob,
      { storageId: oldOutputStorageId },
    );
  }

  return null;
}
