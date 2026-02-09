import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { internalQuery } from '../_generated/server';
import { getActiveVersion as getActiveVersionHelper } from '../workflows/definitions/get_active_version';
import { getWorkflowByName as getWorkflowByNameHelper } from '../workflows/definitions/get_workflow_by_name';
import { listWorkflows as listWorkflowsHelper } from '../workflows/definitions/list_workflows';

type WorkflowDefinition = Doc<'wfDefinitions'>;

async function queryVersionsByOrgAndName(
  ctx: { db: QueryCtx['db'] },
  organizationId: string,
  name: string,
) {
  const versions: WorkflowDefinition[] = [];
  for await (const version of ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_and_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )) {
    versions.push(version);
  }
  return versions.sort((a, b) => b.versionNumber - a.versionNumber);
}

export const resolveWorkflow = internalQuery({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.wfDefinitionId);
  },
});

export const getActiveVersion = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await getActiveVersionHelper(ctx, args);
  },
});

export const getWorkflowByName = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await getWorkflowByNameHelper(ctx, args);
  },
});

export const listVersionsByName = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await queryVersionsByOrgAndName(ctx, args.organizationId, args.name);
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
