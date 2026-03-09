/**
 * Resume execution
 */

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
// Inline serialization removed. Always pre-serialize in an action before calling this mutation.
import type { ResumeExecutionArgs, WorkflowExecution } from './types';

import { internal } from '../../_generated/api';
import { INTERMEDIATE_STORAGE_RETENTION_MS } from './cleanup_execution_storage';

type ResumeExecutionData = Partial<
  Pick<WorkflowExecution, 'variables' | 'metadata'>
> & {
  variablesStorageId?: Id<'_storage'>;
  status: 'running';
  waitingFor: undefined;
  updatedAt: number;
};

export async function resumeExecution(
  ctx: MutationCtx,
  args: ResumeExecutionArgs,
): Promise<null> {
  // Get current execution to check for existing storage
  const current = await ctx.db.get(args.executionId);
  const oldStorageId = current?.variablesStorageId;

  const updates: ResumeExecutionData = {
    status: 'running',
    waitingFor: undefined,
    updatedAt: Date.now(),
  };

  if (args.variablesSerialized) {
    updates.variables = args.variablesSerialized;
    updates.variablesStorageId = args.variablesStorageId;

    // Schedule deferred cleanup of old storage blob:
    // 1. Storage ID changed (new storage file created)
    // 2. Transitioned from storage to inline (oldStorageId exists but new one doesn't)
    if (oldStorageId) {
      if (
        !args.variablesStorageId ||
        oldStorageId !== args.variablesStorageId
      ) {
        await ctx.scheduler.runAfter(
          INTERMEDIATE_STORAGE_RETENTION_MS,
          internal.wf_executions.internal_mutations.deleteStorageBlob,
          { storageId: oldStorageId },
        );
      }
    }
  }

  if (args.metadata) {
    const currentMetadata =
      current && 'metadata' in current && current.metadata
        ? JSON.parse(current.metadata)
        : {};
    const merged = {
      ...currentMetadata,
      ...args.metadata,
    };
    updates.metadata = JSON.stringify(merged);
  }

  await ctx.db.patch(args.executionId, updates);
  return null;
}
