import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { queryWithRLS } from '../lib/rls';
import type { Doc } from '../_generated/dataModel';
import { getActiveVersion as getActiveVersionHelper } from '../workflows/definitions/get_active_version';
import { getWorkflowByName as getWorkflowByNameHelper } from '../workflows/definitions/get_workflow_by_name';
import { listWorkflows as listWorkflowsHelper } from '../workflows/definitions/list_workflows';
import { executeDryRun } from '../workflow_engine/execution/dry_run_executor';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';

type WorkflowDefinition = Doc<'wfDefinitions'>;

export const getWorkflowPublic = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.wfDefinitionId);
  },
});

export const getWorkflowInternal = internalQuery({
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

export const getAutomations = queryWithRLS({
  args: {
    organizationId: v.string(),
    searchTerm: v.optional(v.string()),
    status: v.optional(v.array(v.string())),
    paginationOpts: v.object({
      cursor: v.union(v.string(), v.null()),
      numItems: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query('wfDefinitions')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId));

    const allItems: WorkflowDefinition[] = [];
    for await (const item of query) {
      if (item.parentVersionId !== undefined) {
        continue;
      }

      const activeVersion = await getActiveVersionHelper(ctx, {
        organizationId: args.organizationId,
        name: item.name,
      });
      const effectiveStatus = activeVersion ? 'active' : 'draft';

      if (args.status && args.status.length > 0) {
        if (!args.status.includes(effectiveStatus)) {
          continue;
        }
      }

      if (args.searchTerm) {
        const searchLower = args.searchTerm.toLowerCase();
        const matchesName = item.name?.toLowerCase().includes(searchLower);
        const matchesDescription = item.description
          ?.toLowerCase()
          .includes(searchLower);
        if (!matchesName && !matchesDescription) {
          continue;
        }
      }

      allItems.push({
        ...item,
        status: effectiveStatus,
        version: activeVersion?.version ?? item.version,
        versionNumber: activeVersion?.versionNumber ?? item.versionNumber,
      });
    }

    return allItems;
  },
});

export const hasAutomations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query('wfDefinitions')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId));

    for await (const item of query) {
      if (item.parentVersionId === undefined) {
        return true;
      }
    }

    return false;
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
