/**
 * Get steps ordered by execution order
 */

import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import type { GetOrderedStepsArgs } from './types';

export async function getOrderedSteps(
  ctx: QueryCtx,
  args: GetOrderedStepsArgs,
): Promise<Array<Doc<'wfStepDefs'>>> {
  const steps: Array<Doc<'wfStepDefs'>> = [];
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition_order', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .order('asc')) {
    steps.push(step);
  }
  return steps;
}
