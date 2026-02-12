import type { ConvexJsonValue } from '../../../lib/shared/schemas/utils/json-value';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { CompleteExecutionArgs } from './types';

import { internal } from '../../_generated/api';
import { STORAGE_RETENTION_MS } from './cleanup_execution_storage';

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

  // Immediately delete old variables storage only when replaced by a different blob
  if (
    oldVariablesStorageId &&
    args.variablesStorageId &&
    oldVariablesStorageId !== args.variablesStorageId
  ) {
    try {
      await ctx.storage.delete(oldVariablesStorageId);
    } catch (error) {
      console.warn(
        '[completeExecution] Failed to delete old variables storage:',
        oldVariablesStorageId,
        error,
      );
    }
  }

  // Immediately delete old output storage only when replaced by a different blob
  if (
    oldOutputStorageId &&
    args.outputStorageId &&
    oldOutputStorageId !== args.outputStorageId
  ) {
    try {
      await ctx.storage.delete(oldOutputStorageId);
    } catch (error) {
      console.warn(
        '[completeExecution] Failed to delete old output storage:',
        oldOutputStorageId,
        error,
      );
    }
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
