import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { listIntegrations } from './list_integrations';
import { getIntegrationByName } from './get_integration_by_name';

export const listInternal = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listIntegrations(ctx, args);
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
