/**
 * Get draft version
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface GetDraftArgs {
  organizationId: string;
  name: string;
}

export async function getDraft(
  ctx: QueryCtx,
  args: GetDraftArgs,
): Promise<WorkflowDefinition | null> {
  return await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('name', args.name)
        .eq('status', 'draft'),
    )
    .first();
}
