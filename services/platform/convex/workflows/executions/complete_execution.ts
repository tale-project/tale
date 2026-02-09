import type { ConvexJsonValue } from '../../../lib/shared/schemas/utils/json-value';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { CompleteExecutionArgs } from './types';

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
  // Get current execution to check for existing storage and clean up
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

  // Clean up old variables storage (ignore errors if already deleted)
  if (oldVariablesStorageId) {
    const shouldDelete =
      !updates.variablesStorageId ||
      oldVariablesStorageId !== updates.variablesStorageId;
    if (shouldDelete) {
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
  }

  // Clean up old output storage (ignore errors if already deleted)
  if (oldOutputStorageId) {
    const shouldDelete =
      !updates.outputStorageId ||
      oldOutputStorageId !== updates.outputStorageId;
    if (shouldDelete) {
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
  }

  return null;
}
