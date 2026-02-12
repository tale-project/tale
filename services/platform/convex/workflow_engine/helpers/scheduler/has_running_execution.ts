/**
 * Check if a workflow definition has any execution currently in 'running' or 'pending' status.
 * Used by the scheduler to prevent concurrent executions of the same workflow.
 */

import type { Id } from '../../../_generated/dataModel';

import { QueryCtx } from '../../../_generated/server';

export async function hasRunningExecution(
  ctx: QueryCtx,
  args: { wfDefinitionId: Id<'wfDefinitions'> },
): Promise<boolean> {
  const running = await ctx.db
    .query('wfExecutions')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .filter((q) =>
      q.or(
        q.eq(q.field('status'), 'running'),
        q.eq(q.field('status'), 'pending'),
      ),
    )
    .first();

  return running !== null;
}

/**
 * Batch version to check running executions for multiple workflow definitions.
 */
export async function hasRunningExecutions(
  ctx: QueryCtx,
  args: { wfDefinitionIds: Id<'wfDefinitions'>[] },
): Promise<Map<Id<'wfDefinitions'>, boolean>> {
  const entries = await Promise.all(
    args.wfDefinitionIds.map(async (wfDefinitionId) => {
      const result = await hasRunningExecution(ctx, { wfDefinitionId });
      return [wfDefinitionId, result] as const;
    }),
  );

  return new Map(entries);
}
