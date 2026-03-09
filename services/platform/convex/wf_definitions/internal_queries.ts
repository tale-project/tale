import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { internalQuery } from '../_generated/server';
import { getActiveVersion as getActiveVersionHelper } from '../workflows/definitions/get_active_version';
import { getWorkflowByName as getWorkflowByNameHelper } from '../workflows/definitions/get_workflow_by_name';
import { listWorkflows as listWorkflowsHelper } from '../workflows/definitions/list_workflows';
import { workflowStatusValidator } from '../workflows/definitions/validators';

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

export const getStartStepConfig = internalQuery({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    for await (const step of ctx.db
      .query('wfStepDefs')
      .withIndex('by_definition', (q) =>
        q.eq('wfDefinitionId', args.wfDefinitionId),
      )) {
      if (step.stepType === 'start' || step.stepType === 'trigger') {
        return step.config;
      }
    }
    return null;
  },
});

export const listWorkflows = internalQuery({
  args: {
    organizationId: v.string(),
    status: v.optional(workflowStatusValidator),
  },
  handler: async (ctx, args) => {
    return await listWorkflowsHelper(ctx, args);
  },
});
