import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getIntegrationByName } from './get_integration_by_name';
import { listIntegrations } from './list_integrations';

export const listInternal = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listIntegrations(ctx, args);
  },
});

export const getInternal = internalQuery({
  args: {
    integrationId: v.id('integrations'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.integrationId);
  },
});

export const getByName = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await getIntegrationByName(ctx, args);
  },
});
