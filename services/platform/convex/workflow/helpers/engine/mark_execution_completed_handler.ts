/**
 * Mark Execution Completed Handler - Business Logic
 *
 * Contains the business logic for marking a workflow execution as completed.
 */

import type { MutationCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';

export type MarkExecutionCompletedArgs = {
  executionId: Id<'wfExecutions'>;
};

/**
 * Handle marking an execution as completed
 */
export async function handleMarkExecutionCompleted(
  ctx: MutationCtx,
  args: MarkExecutionCompletedArgs,
): Promise<null> {
  // Get current execution to use its variables as final output
  const execution = await ctx.db.get(args.executionId);

  // Parse variables - if they're in storage, just use a placeholder
  // The actual data is already persisted in storage
  let finalOutput: unknown = {};
  if (execution?.variables) {
    try {
      const parsed = JSON.parse(execution.variables);
      // If variables are in storage, use a reference object
      finalOutput = parsed._storageRef
        ? {
            _note: 'Variables stored in Convex storage',
            _storageRef: parsed._storageRef,
          }
        : parsed;
    } catch {
      finalOutput = {};
    }
  }

  // Persist execution completion (keep full output on execution record for UI/use)
  await ctx.db.patch(args.executionId, {
    status: 'completed',
    output: finalOutput,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  });

  return null;
}

