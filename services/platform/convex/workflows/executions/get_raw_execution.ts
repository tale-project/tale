import type { QueryCtx } from '../../_generated/server';
import type { Id, Doc } from '../../_generated/dataModel';

export async function getRawExecution(
  ctx: QueryCtx,
  executionId: Id<'wfExecutions'>,
): Promise<Doc<'wfExecutions'> | null> {
  return await ctx.db.get(executionId);
}

