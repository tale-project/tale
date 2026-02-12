/**
 * Recovery mechanism for stuck workflow executions.
 *
 * Finds executions stuck in 'running' or 'pending' status for longer than
 * the maximum allowed duration and marks them as failed. This prevents
 * orphaned executions from accumulating when the onComplete callback
 * never fires (e.g., IMAP hangs, component crashes).
 */

import type { MutationCtx } from '../../../_generated/server';

const MAX_RUNNING_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const BATCH_SIZE = 50;

export async function recoverStuckExecutions(
  ctx: MutationCtx,
): Promise<{ recovered: number }> {
  const cutoffMs = Date.now() - MAX_RUNNING_DURATION_MS;
  let recovered = 0;

  for await (const execution of ctx.db
    .query('wfExecutions')
    .withIndex('by_status', (q) => q.eq('status', 'running'))) {
    if (recovered >= BATCH_SIZE) break;

    if (execution.updatedAt < cutoffMs) {
      await ctx.db.patch(execution._id, {
        status: 'failed',
        updatedAt: Date.now(),
        metadata: JSON.stringify({
          error: `Execution timed out after ${MAX_RUNNING_DURATION_MS / 60_000} minutes (stuck recovery)`,
          recoveredAt: Date.now(),
          previousStatus: 'running',
        }),
      });
      recovered++;
    }
  }

  for await (const execution of ctx.db
    .query('wfExecutions')
    .withIndex('by_status', (q) => q.eq('status', 'pending'))) {
    if (recovered >= BATCH_SIZE) break;

    if (execution.updatedAt < cutoffMs) {
      await ctx.db.patch(execution._id, {
        status: 'failed',
        updatedAt: Date.now(),
        metadata: JSON.stringify({
          error: `Execution timed out in pending state after ${MAX_RUNNING_DURATION_MS / 60_000} minutes (stuck recovery)`,
          recoveredAt: Date.now(),
          previousStatus: 'pending',
        }),
      });
      recovered++;
    }
  }

  return { recovered };
}
