import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export const STORAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CleanupExecutionStorageArgs {
  executionId: Id<'wfExecutions'>;
  variablesStorageId?: Id<'_storage'>;
  outputStorageId?: Id<'_storage'>;
}

export async function cleanupExecutionStorage(
  ctx: MutationCtx,
  args: CleanupExecutionStorageArgs,
): Promise<null> {
  const execution = await ctx.db.get(args.executionId);
  if (!execution) return null;

  if (
    args.variablesStorageId &&
    execution.variablesStorageId === args.variablesStorageId
  ) {
    try {
      await ctx.storage.delete(args.variablesStorageId);
    } catch {
      // Blob may already be deleted
    }
    await ctx.db.patch(args.executionId, {
      variablesStorageId: undefined,
    });
  }

  if (
    args.outputStorageId &&
    execution.outputStorageId === args.outputStorageId
  ) {
    try {
      await ctx.storage.delete(args.outputStorageId);
    } catch {
      // Blob may already be deleted
    }
    await ctx.db.patch(args.executionId, {
      outputStorageId: undefined,
    });
  }

  return null;
}
