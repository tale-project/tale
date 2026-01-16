/**
 * Complete execution
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
// Inline serialization removed. Always pre-serialize in an action before calling this mutation.
import type { CompleteExecutionArgs } from './types';

type CompleteExecutionData = {
  output: unknown;
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
  const oldStorageId = execution?.variablesStorageId;

  const updates: CompleteExecutionData = {
    status: 'completed',
    output: args.output,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (args.variablesSerialized) {
    updates.variables = args.variablesSerialized;
    updates.variablesStorageId = args.variablesStorageId;
  }

  await ctx.db.patch(args.executionId, updates);

  // Clean up old storage in these cases:
  // 1. Storage ID changed (new storage file created)
  // 2. Transitioned from storage to inline (oldStorageId exists but new one doesn't)
  if (oldStorageId) {
    if (!updates.variablesStorageId) {
      await ctx.storage.delete(oldStorageId);
    } else if (oldStorageId !== updates.variablesStorageId) {
      await ctx.storage.delete(oldStorageId);
    }
  }

  return null;
}
