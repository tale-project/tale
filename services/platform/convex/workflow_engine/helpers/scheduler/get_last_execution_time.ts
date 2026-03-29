/**
 * Helper function to get the last execution start time (ms since epoch) for a workflow.
 *
 * Accepts either a Convex ID or a workflow slug string — the by_definition_startedAt
 * index works with both since wfDefinitionId is v.union(v.id, v.string, v.null).
 */

import { QueryCtx } from '../../../_generated/server';

export async function getLastExecutionTime(
  ctx: QueryCtx,
  args: { wfDefinitionId: string },
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

/**
 * Batch version to get last execution times for multiple workflows.
 * Reduces N+1 query problem when checking many workflows.
 *
 * NOTE: This still performs individual queries per workflow, but batches them
 * in the same function call to reduce overhead. The alternative of querying
 * all executions at once risks hitting the 16MB read limit.
 */
export async function getLastExecutionTimes(
  ctx: QueryCtx,
  args: { wfDefinitionIds: string[] },
): Promise<Map<string, number | null>> {
  const entries = await Promise.all(
    args.wfDefinitionIds.map(async (wfDefinitionId) => {
      const last = await getLastExecutionTime(ctx, { wfDefinitionId });
      return [wfDefinitionId, last] as const;
    }),
  );

  return new Map(entries);
}
