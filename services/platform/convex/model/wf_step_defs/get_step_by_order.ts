/**
 * Get step by order
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { GetStepByOrderArgs } from './types';

export async function getStepByOrder(
  ctx: QueryCtx,
  args: GetStepByOrderArgs,
): Promise<Doc<'wfStepDefs'> | null> {
  return await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition_order', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId).eq('order', args.order),
    )
    .first();
}

