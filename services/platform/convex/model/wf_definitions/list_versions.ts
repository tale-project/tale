/**
 * List all versions of a workflow
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface ListVersionsArgs {
  organizationId: string;
  name: string;
}

export async function listVersions(
  ctx: QueryCtx,
  args: ListVersionsArgs,
): Promise<WorkflowDefinition[]> {
  const versions = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_and_name', (q) =>
      q.eq('organizationId', args.organizationId).eq('name', args.name),
    )
    .collect();

  // Sort by version number descending (newest first)
  return versions.sort((a, b) => b.versionNumber - a.versionNumber);
}
