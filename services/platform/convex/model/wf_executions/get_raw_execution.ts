/**
 * Get raw execution by ID (without deserializing variables)
 * 
 * This is used when we need to access the serialized variables string
 * to fetch from storage in an action context.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { Doc } from '../../_generated/dataModel';

export async function getRawExecution(
  ctx: QueryCtx,
  executionId: Id<'wfExecutions'>,
): Promise<Doc<'wfExecutions'> | null> {
  return await ctx.db.get(executionId);
}

