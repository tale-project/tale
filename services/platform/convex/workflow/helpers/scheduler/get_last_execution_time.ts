/**
 * Helper function to get the last execution start time (ms since epoch) for a workflow definition
 */

import { QueryCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';

export async function getLastExecutionTime(
  ctx: QueryCtx,
  args: { wfDefinitionId: Id<'wfDefinitions'> },
): Promise<number | null> {
  const last = await ctx.db
    .query('wfExecutions')
    .withIndex('by_definition_startedAt', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .order('desc')
    .first();

  return last ? last.startedAt : null;
}
