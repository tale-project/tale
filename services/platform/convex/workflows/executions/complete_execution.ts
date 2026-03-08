import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { ConvexJsonValue } from '../../lib/validators/json';
import type { CompleteExecutionArgs } from './types';

import { internal } from '../../_generated/api';
import {
  INTERMEDIATE_STORAGE_RETENTION_MS,
  STORAGE_RETENTION_MS,
} from './cleanup_execution_storage';

type CompleteExecutionData = {
  output: ConvexJsonValue;
  outputStorageId?: Id<'_storage'>;
  variables?: string;
  variablesStorageId?: Id<'_storage'>;
  status: 'completed';
  completedAt: number;
  updatedAt: number;
};

export async function completeExecution(
  ctx: MutationCtx,
  args: CompleteExecutionArgs,
): Promise<null> {
  const execution = await ctx.db.get(args.executionId);
  const oldVariablesStorageId = execution?.variablesStorageId;
  const oldOutputStorageId = execution?.outputStorageId;

  const updates: CompleteExecutionData = {
    status: 'completed',
    output: args.output,
    outputStorageId: args.outputStorageId,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (args.variablesSerialized) {
    updates.variables = args.variablesSerialized;
    updates.variablesStorageId = args.variablesStorageId;
  }

  await ctx.db.patch(args.executionId, updates);

  // Schedule deferred cleanup of old variables storage when replaced by a different blob
  if (
    oldVariablesStorageId &&
    args.variablesStorageId &&
    oldVariablesStorageId !== args.variablesStorageId
  ) {
    await ctx.scheduler.runAfter(
      INTERMEDIATE_STORAGE_RETENTION_MS,
      internal.wf_executions.internal_mutations.deleteStorageBlob,
      { storageId: oldVariablesStorageId },
    );
  }

  // Schedule deferred cleanup of old output storage when replaced by a different blob
  if (
    oldOutputStorageId &&
    args.outputStorageId &&
    oldOutputStorageId !== args.outputStorageId
  ) {
    await ctx.scheduler.runAfter(
      INTERMEDIATE_STORAGE_RETENTION_MS,
      internal.wf_executions.internal_mutations.deleteStorageBlob,
      { storageId: oldOutputStorageId },
    );
  }

  // Schedule delayed cleanup of final storage blobs after 30 days
  const finalVariablesStorageId =
    args.variablesStorageId ??
    (args.variablesSerialized ? undefined : oldVariablesStorageId);
  const finalOutputStorageId = args.outputStorageId ?? oldOutputStorageId;

  if (finalVariablesStorageId || finalOutputStorageId) {
    await ctx.scheduler.runAfter(
      STORAGE_RETENTION_MS,
      internal.wf_executions.internal_mutations.cleanupExecutionStorage,
      {
        executionId: args.executionId,
        variablesStorageId: finalVariablesStorageId,
        outputStorageId: finalOutputStorageId,
      },
    );
  }

  return null;
}
