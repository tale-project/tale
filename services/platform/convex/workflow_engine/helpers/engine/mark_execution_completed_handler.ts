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
 * Maximum size for inline storage of workflow execution output.
 * Set to 900KB to stay safely under Convex's 1MB document size limit.
 */
const MAX_INLINE_OUTPUT_SIZE = 900 * 1024;

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
      if (parsed._storageRef) {
        finalOutput = {
          _note: 'Variables stored in Convex storage',
          _storageRef: parsed._storageRef,
        };
      } else {
        // Check size before storing inline
        const outputJson = JSON.stringify(parsed);
        const sizeInBytes = new Blob([outputJson]).size;

        if (sizeInBytes > MAX_INLINE_OUTPUT_SIZE) {
          // Output is too large - store a summary instead
          finalOutput = {
            _note: 'Output too large for inline storage',
            _size: `${(sizeInBytes / 1024 / 1024).toFixed(2)} MiB`,
            _warning: 'Full output exceeded size limit and was truncated',
            _storageRef: parsed._storageRef || null,
          };
        } else {
          finalOutput = parsed;
        }
      }
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

