import type { MutationCtx } from '../../_generated/server';
import type { UpdateExecutionStatusArgs, WorkflowExecution } from './types';
import { mergeExecutionMetadata } from './update_execution_metadata';

type ExecutionUpdateData = Partial<
  Pick<
    WorkflowExecution,
    | 'status'
    | 'currentStepSlug'
    | 'currentStepName'
    | 'loopProgress'
    | 'waitingFor'
    | 'error'
    | 'errorCode'
    | 'metadata'
    | 'completedAt'
  >
> & {
  updatedAt: number;
};

export async function updateExecutionStatus(
  ctx: MutationCtx,
  args: UpdateExecutionStatusArgs,
): Promise<null> {
  const updates: ExecutionUpdateData = {
    status: args.status,
    updatedAt: Date.now(),
  };

  if (args.currentStepSlug !== undefined) {
    updates.currentStepSlug = args.currentStepSlug;
  }

  if (args.currentStepName !== undefined) {
    updates.currentStepName = args.currentStepName;
  }

  if (args.loopProgress !== undefined) {
    updates.loopProgress = args.loopProgress ?? undefined;
  }

  if (args.waitingFor !== undefined) {
    // Empty string signals "clear the field"
    updates.waitingFor = args.waitingFor || undefined;
  }

  if (args.error !== undefined) {
    // Persist at the top level (what getExecutionStatus and the UI read) and
    // merge into metadata so existing keys (componentWorkflowIds, …) survive.
    const execution = await ctx.db.get(args.executionId);
    updates.error = args.error;
    updates.metadata = mergeExecutionMetadata(execution?.metadata, {
      error: args.error,
    });
  }

  if (args.errorCode !== undefined) {
    updates.errorCode = args.errorCode;
  }

  if (args.status === 'completed' || args.status === 'failed') {
    updates.completedAt = Date.now();
  }

  await ctx.db.patch(args.executionId, updates);
  return null;
}
