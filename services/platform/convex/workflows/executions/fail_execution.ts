/**
 * Fail execution
 */

import type { MutationCtx } from '../../_generated/server';
import type { FailExecutionArgs } from './types';

import { internal } from '../../_generated/api';
import { STORAGE_RETENTION_MS } from './cleanup_execution_storage';

export async function failExecution(
  ctx: MutationCtx,
  args: FailExecutionArgs,
): Promise<null> {
  const execution = await ctx.db.get(args.executionId);

  await ctx.db.patch(args.executionId, {
    status: 'failed',
    metadata: JSON.stringify({ error: args.error }),
    updatedAt: Date.now(),
  });

  // Schedule delayed cleanup of storage blobs after 30 days
  const variablesStorageId = execution?.variablesStorageId;
  const outputStorageId = execution?.outputStorageId;

  if (variablesStorageId || outputStorageId) {
    await ctx.scheduler.runAfter(
      STORAGE_RETENTION_MS,
      internal.wf_executions.internal_mutations.cleanupExecutionStorage,
      {
        executionId: args.executionId,
        variablesStorageId,
        outputStorageId,
      },
    );
  }

  return null;
}
