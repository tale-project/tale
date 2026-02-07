import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { executeDryRun } from '../workflow_engine/execution/dry_run_executor';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { listAutomations as listAutomationsHandler } from '../workflows/definitions/list_automations';

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

export const getWorkflow = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.wfDefinitionId);
  },
});

export const listVersions = queryWithRLS({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await queryVersionsByOrgAndName(ctx, args.organizationId, args.name);
  },
});

export const listAutomations = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listAutomationsHandler(ctx, args);
  },
});

export const listAutomationRoots = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfDefinitions')
      .withIndex('by_org_versionNumber', (q) =>
        q.eq('organizationId', args.organizationId).eq('versionNumber', 1),
      )
      .take(200);
  },
});

export const hasAutomations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const root = await ctx.db
      .query('wfDefinitions')
      .withIndex('by_org_versionNumber', (q) =>
        q.eq('organizationId', args.organizationId).eq('versionNumber', 1),
      )
      .first();
    return root !== null;
  },
});

export const dryRunWorkflow = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(jsonValueValidator),
  },
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.wfDefinitionId);
    if (!workflow) {
      return {
        success: false,
        executionPath: [],
        stepResults: [],
        errors: ['Workflow not found'],
        warnings: [],
      };
    }

    const steps: Doc<'wfStepDefs'>[] = [];
    for await (const step of ctx.db
      .query('wfStepDefs')
      .withIndex('by_definition', (q) =>
        q.eq('wfDefinitionId', args.wfDefinitionId),
      )) {
      steps.push(step);
    }

    return executeDryRun(workflow, steps, args.input ?? {});
  },
});
