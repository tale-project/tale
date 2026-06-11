/**
 * Fail execution
 */

import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { STORAGE_RETENTION_MS } from './cleanup_execution_storage';
import type { FailExecutionArgs } from './types';
import { mergeExecutionMetadata } from './update_execution_metadata';

/**
 * Emit a `workflow.failed` notification exactly once for an execution,
 * regardless of which failure path drove it there. Idempotent via the
 * `failureNotifiedAt` marker, so the engine callback, the stuck-recovery
 * watchdog, the start-failure path, and the dynamic next-step pre-mark can all
 * call it without double-notifying. Best-effort (scheduled fire-and-forget) so
 * it never blocks the failing transition.
 *
 * `workflow.failed` is default-on in the notification catalog; this is the
 * single chokepoint that guarantees those alerts actually fire. REST
 * cancellation and the `canceled` engine outcome do NOT route through here, so
 * they are correctly excluded from failure alerts.
 */
export async function notifyWorkflowFailedOnce(
  ctx: MutationCtx,
  execution: Doc<'wfExecutions'> | null,
  error: string | undefined,
): Promise<void> {
  if (!execution || execution.failureNotifiedAt != null) return;

  await ctx.db.patch(execution._id, { failureNotifiedAt: Date.now() });
  await ctx.scheduler.runAfter(
    0,
    internal.notifications.dispatch_notification.dispatchNotificationAction,
    {
      organizationId: execution.organizationId,
      eventType: 'workflow.failed',
      params: { workflowSlug: execution.workflowSlug ?? 'workflow', error },
    },
  );
}

export async function failExecution(
  ctx: MutationCtx,
  args: FailExecutionArgs,
): Promise<null> {
  const execution = await ctx.db.get(args.executionId);

  await ctx.db.patch(args.executionId, {
    status: 'failed',
    // Top-level `error` is what getExecutionStatus / the executions table /
    // the test panel read; the metadata copy is merged (not replaced) so
    // `componentWorkflowIds` and other keys survive the failure transition.
    error: args.error,
    ...(args.errorCode !== undefined ? { errorCode: args.errorCode } : {}),
    completedAt: execution?.completedAt ?? Date.now(),
    metadata: mergeExecutionMetadata(execution?.metadata, {
      error: args.error,
    }),
    updatedAt: Date.now(),
  });

  // Fire the default-on failure notification once for this execution.
  await notifyWorkflowFailedOnce(ctx, execution, args.error);

  // Schedule delayed cleanup of storage blobs after 30 days
  const variablesStorageId = execution?.variablesStorageId;
  const outputStorageId = execution?.outputStorageId;

  if (variablesStorageId || outputStorageId) {
    await ctx.scheduler.runAfter(
      STORAGE_RETENTION_MS,
      internal.wf_executions.internal_mutations.cleanupExecutionStorage,
      {
        executionId: args.executionId,
        variablesStorageId,
        outputStorageId,
      },
    );
  }

  return null;
}
