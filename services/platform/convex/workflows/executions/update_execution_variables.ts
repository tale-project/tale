/**
 * Update execution variables
 */

import type { MutationCtx } from '../../_generated/server';
// Inline serialization removed. Always pre-serialize in an action before calling this mutation.
import type { UpdateExecutionVariablesArgs } from './types';

export async function updateExecutionVariables(
  ctx: MutationCtx,
  args: UpdateExecutionVariablesArgs,
): Promise<null> {
  // Get current execution to check for existing storage
  const execution = await ctx.db.get(args.executionId);

  // If the execution was deleted (for example because the workflow definition
  // was removed while a step was still finishing), treat this as a no-op
  // instead of throwing.
  if (!execution) {
    return null;
  }

  const oldStorageId = execution.variablesStorageId;

  // If caller provided pre-serialized values (from an action), use them directly
  if (args.variablesSerialized) {
    await ctx.db.patch(execution._id, {
      variables: args.variablesSerialized,
      variablesStorageId: args.variablesStorageId,
      updatedAt: Date.now(),
    });

    // Clean up old storage in these cases:
    // 1. Storage ID changed (new storage file created)
    // 2. Transitioned from storage to inline (oldStorageId exists but new one doesn't)
    if (oldStorageId) {
      if (!args.variablesStorageId) {
        await ctx.storage.delete(oldStorageId);
      } else if (oldStorageId !== args.variablesStorageId) {
        await ctx.storage.delete(oldStorageId);
      }
    }

    return null;
  }

  // Inline serialization is no longer supported in mutations.
  // Always pre-serialize in an action and pass variablesSerialized (+ optional variablesStorageId).
  // If neither serialized nor raw variables provided, it's a no-op update.
  return null;
}
