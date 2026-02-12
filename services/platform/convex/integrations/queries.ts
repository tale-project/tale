import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { query, QueryCtx } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { getIntegration } from './get_integration';
import { getIntegrationByName } from './get_integration_by_name';
import { listIntegrations } from './list_integrations';
import { integrationDocValidator } from './validators';

type IntegrationWithIcon = Doc<'integrations'> & { iconUrl: string | null };

async function withIconUrl(
  ctx: QueryCtx,
  integration: Doc<'integrations'>,
): Promise<IntegrationWithIcon> {
  const iconUrl = integration.iconStorageId
    ? await ctx.storage.getUrl(integration.iconStorageId)
    : null;
  return { ...integration, iconUrl };
}

export const get = query({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: v.union(integrationDocValidator, v.null()),
  handler: async (ctx, args): Promise<IntegrationWithIcon | null> => {
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

    return await withIconUrl(ctx, integration);
  },
});

export const getByName = query({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(integrationDocValidator, v.null()),
  handler: async (ctx, args): Promise<IntegrationWithIcon | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return null;
    }

    const integration = await getIntegrationByName(ctx, args);
    if (!integration) {
      return null;
    }

    return await withIconUrl(ctx, integration);
  },
});

export const list = query({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.array(integrationDocValidator),
  handler: async (ctx, args): Promise<IntegrationWithIcon[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return [];
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return [];
    }

    const integrations = await listIntegrations(ctx, args);
    return await Promise.all(
      integrations.map((integration) => withIconUrl(ctx, integration)),
    );
  },
});
