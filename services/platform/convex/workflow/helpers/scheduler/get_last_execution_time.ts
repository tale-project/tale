/**
 * Helper function to get the last execution start time (ms since epoch) for a workflow definition
 */

import { QueryCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';

export async function getLastExecutionTime(
  ctx: QueryCtx,
  args: { wfDefinitionId: Id<'wfDefinitions'> },
): Promise<number | null> {
  // Use first() with order('desc') for optimal performance
  // The index 'by_definition_startedAt' should have wfDefinitionId first, then startedAt
  const last = await ctx.db
    .query('wfExecutions')
    .withIndex('by_definition_startedAt', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .order('desc')
    .first();

  return last ? last.startedAt : null;
}

/**
 * Batch version to get last execution times for multiple workflows
 * Reduces N+1 query problem when checking many workflows
 *
 * NOTE: This still performs individual queries per workflow, but batches them
 * in the same function call to reduce overhead. The alternative of querying
 * all executions at once risks hitting the 16MB read limit.
 */
export async function getLastExecutionTimes(
  ctx: QueryCtx,
  args: { wfDefinitionIds: Id<'wfDefinitions'>[] },
): Promise<Map<Id<'wfDefinitions'>, number | null>> {
  const result = new Map<Id<'wfDefinitions'>, number | null>();

  // Query each workflow's last execution individually
  // This is more efficient than loading all executions and filtering
  // because it uses the index efficiently and only reads the first result
  for (const wfDefinitionId of args.wfDefinitionIds) {
    const last = await ctx.db
      .query('wfExecutions')
      .withIndex('by_definition_startedAt', (q) =>
        q.eq('wfDefinitionId', wfDefinitionId),
      )
      .order('desc')
      .first();

    result.set(wfDefinitionId, last ? last.startedAt : null);
  }

  return result;
}
