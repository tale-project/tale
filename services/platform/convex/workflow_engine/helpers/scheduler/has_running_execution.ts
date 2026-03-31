/**
 * Check if a workflow has any execution currently in 'running' or 'pending' status.
 * Used by the scheduler to prevent concurrent executions of the same workflow.
 *
 * Accepts either a Convex ID or a workflow slug string — the by_definition_status
 * index works with both since wfDefinitionId is v.union(v.id, v.string, v.null).
 */

import { QueryCtx } from '../../../_generated/server';

export async function hasRunningExecution(
  ctx: QueryCtx,
  args: { wfDefinitionId: string },
): Promise<boolean> {
  const [running, pending] = await Promise.all([
    ctx.db
      .query('wfExecutions')
      .withIndex('by_definition_status', (q) =>
        q.eq('wfDefinitionId', args.wfDefinitionId).eq('status', 'running'),
      )
      .first(),
    ctx.db
      .query('wfExecutions')
      .withIndex('by_definition_status', (q) =>
        q.eq('wfDefinitionId', args.wfDefinitionId).eq('status', 'pending'),
      )
      .first(),
  ]);

  return running !== null || pending !== null;
}

/**
 * Batch version to check running executions for multiple workflows.
 */
export async function hasRunningExecutions(
  ctx: QueryCtx,
  args: { wfDefinitionIds: string[] },
): Promise<Map<string, boolean>> {
  const entries = await Promise.all(
    args.wfDefinitionIds.map(async (wfDefinitionId) => {
      const result = await hasRunningExecution(ctx, { wfDefinitionId });
      return [wfDefinitionId, result] as const;
    }),
  );

  return new Map(entries);
}
