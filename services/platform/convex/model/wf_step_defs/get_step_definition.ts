/**
 * Get step definition by workflow and step ID
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { GetStepDefinitionArgs } from './types';

export async function getStepDefinition(
  ctx: QueryCtx,
  args: GetStepDefinitionArgs,
): Promise<Doc<'wfStepDefs'> | null> {
  return await ctx.db
    .query('wfStepDefs')
    .withIndex('by_step_slug', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId).eq('stepSlug', args.stepSlug),
    )
    .first();
}
