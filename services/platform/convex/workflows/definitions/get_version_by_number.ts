/**
 * Get specific version by version number
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface GetVersionByNumberArgs {
  organizationId: string;
  name: string;
  versionNumber: number;
}

export async function getVersionByNumber(
  ctx: QueryCtx,
  args: GetVersionByNumberArgs,
): Promise<WorkflowDefinition | null> {
  return await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_version', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('name', args.name)
        .eq('versionNumber', args.versionNumber),
    )
    .first();
}
