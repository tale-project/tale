/**
 * Lookup workflow definition by organization and name.
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface GetWorkflowByNameArgs {
  organizationId: string;
  name: string;
}

export async function getWorkflowByName(
  ctx: QueryCtx,
  args: GetWorkflowByNameArgs,
): Promise<WorkflowDefinition | null> {
  const workflow = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_and_name', (q) =>
      q.eq('organizationId', args.organizationId).eq('name', args.name),
    )
    .first();

  return (workflow as WorkflowDefinition | null) ?? null;
}

