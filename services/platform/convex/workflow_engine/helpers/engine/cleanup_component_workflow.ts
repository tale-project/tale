/**
 * Cleanup component workflow after a delay.
 *
 * This is used when deleting workflow definitions: we cancel in-progress
 * component workflows immediately, then schedule this mutation via
 * ctx.scheduler.runAfter to clean up their journal/state once the
 * workflow engine has finished its own cancellation/onComplete logic.
 */

import type { WorkflowManager, WorkflowId } from '@convex-dev/workflow';

import type { MutationCtx } from '../../../_generated/server';

export async function cleanupComponentWorkflow(
  workflowManager: WorkflowManager,
  ctx: MutationCtx,
  workflowId: WorkflowId,
): Promise<void> {
  await workflowManager.cleanup(ctx, workflowId);
}
