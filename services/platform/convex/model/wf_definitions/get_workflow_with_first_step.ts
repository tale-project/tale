/**
 * Get workflow definition with first step
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { WorkflowDefinitionWithFirstStep } from './types';

export async function getWorkflowWithFirstStep(
  ctx: QueryCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<WorkflowDefinitionWithFirstStep | null> {
  const workflow = await ctx.db.get(wfDefinitionId);
  if (!workflow) return null;

  // Get first step
  const firstStep = await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition_order', (q) =>
      q.eq('wfDefinitionId', wfDefinitionId).eq('order', 1),
    )
    .first();

  return {
    ...workflow,
    firstStepSlug: firstStep?.stepSlug || null,
  };
}
