/**
 * Get steps by type
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { GetStepsByTypeArgs } from './types';

export async function getStepsByType(
  ctx: QueryCtx,
  args: GetStepsByTypeArgs,
): Promise<Array<Doc<'wfStepDefs'>>> {
  const allSteps = await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', args.wfDefinitionId))
    .collect();

  return allSteps.filter((step) => step.stepType === args.stepType);
}

