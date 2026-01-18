/**
 * Public and internal queries for listing workflow versions
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { queryWithRLS } from '../../lib/rls';
import type { Doc } from '../../_generated/dataModel';
import { listWorkflows as listWorkflowsHelper } from '../../workflows/definitions/list_workflows';

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

export const listVersions = internalQuery({
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

export const listWorkflows = internalQuery({
  args: {
    organizationId: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listWorkflowsHelper(ctx, args);
  },
});
