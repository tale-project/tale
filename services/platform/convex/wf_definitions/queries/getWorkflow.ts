/**
 * Public and internal queries for getting a workflow
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { queryWithRLS } from '../../lib/rls';
import { getActiveVersion as getActiveVersionHelper } from '../../workflows/definitions/get_active_version';
import { getWorkflowByName as getWorkflowByNameHelper } from '../../workflows/definitions/get_workflow_by_name';

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
