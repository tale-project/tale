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
