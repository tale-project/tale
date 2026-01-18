/**
 * Public query for listing workflow versions
 * Re-exported at top level for api.wf_definitions.listVersionsPublic
 */

import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import type { Doc } from '../_generated/dataModel';

type WorkflowDefinition = Doc<'wfDefinitions'>;

export const listVersionsPublic = queryWithRLS({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const versions: WorkflowDefinition[] = [];
    for await (const version of ctx.db
      .query('wfDefinitions')
      .withIndex('by_org_and_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )) {
      versions.push(version);
    }

    // Sort by version number descending (newest first)
    return versions.sort((a, b) => b.versionNumber - a.versionNumber);
  },
});
