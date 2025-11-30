/**
 * Get active version
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface GetActiveVersionArgs {
  organizationId: string;
  name: string;
}

export async function getActiveVersion(
  ctx: QueryCtx,
  args: GetActiveVersionArgs,
): Promise<WorkflowDefinition | null> {
  return await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('name', args.name)
        .eq('status', 'active'),
    )
    .first();
}
