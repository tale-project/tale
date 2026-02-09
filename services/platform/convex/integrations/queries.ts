import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { getIntegration } from './get_integration';
import { getIntegrationByName } from './get_integration_by_name';
import { listIntegrations } from './list_integrations';
import { integrationDocValidator } from './validators';

export const get = query({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: v.union(integrationDocValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    const integration = await getIntegration(ctx, args.integrationId);
    if (!integration) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, integration.organizationId, authUser);
    } catch {
      return null;
    }

    return integration;
  },
});

export const getByName = query({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(integrationDocValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return null;
    }

    return await getIntegrationByName(ctx, args);
  },
});

export const list = query({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.array(integrationDocValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return [];
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return [];
    }

    return await listIntegrations(ctx, args);
  },
});
