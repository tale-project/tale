/**
 * Get workflow definition by ID
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { WorkflowDefinition } from './types';

export async function getWorkflow(
  ctx: QueryCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<WorkflowDefinition | null> {
  return await ctx.db.get(wfDefinitionId);
}

