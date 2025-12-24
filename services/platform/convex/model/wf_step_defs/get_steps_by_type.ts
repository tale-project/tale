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
  const steps: Array<Doc<'wfStepDefs'>> = [];

  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', args.wfDefinitionId))) {
    if (step.stepType === args.stepType) {
      steps.push(step);
    }
  }

  return steps;
}

