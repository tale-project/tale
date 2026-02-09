import type { MutationCtx } from '../../_generated/server';
import type { UpdateExecutionStatusArgs, WorkflowExecution } from './types';

type ExecutionUpdateData = Partial<
  Pick<
    WorkflowExecution,
    'status' | 'currentStepSlug' | 'waitingFor' | 'metadata' | 'completedAt'
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

  if (args.waitingFor !== undefined) {
    updates.waitingFor = args.waitingFor;
  }

  if (args.error !== undefined) {
    updates.metadata = JSON.stringify({ error: args.error });
  }

  if (args.status === 'completed') {
    updates.completedAt = Date.now();
  }

  await ctx.db.patch(args.executionId, updates);
  return null;
}
