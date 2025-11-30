/**
 * Get next step in sequence
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { GetNextStepInSequenceArgs } from './types';

export async function getNextStepInSequence(
  ctx: QueryCtx,
  args: GetNextStepInSequenceArgs,
): Promise<Doc<'wfStepDefs'> | null> {
  return await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition_order', (q) =>
      q
        .eq('wfDefinitionId', args.wfDefinitionId)
        .eq('order', args.currentOrder + 1),
    )
    .first();
}

