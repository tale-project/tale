/**
 * List all steps for a workflow
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { ListWorkflowStepsArgs } from './types';

export async function listWorkflowSteps(
  ctx: QueryCtx,
  args: ListWorkflowStepsArgs,
): Promise<Array<Doc<'wfStepDefs'>>> {
  return await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', args.wfDefinitionId))
    .order('asc')
    .collect();
}

