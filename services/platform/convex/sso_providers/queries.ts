/**
 * SSO Providers Queries
 *
 * Queries for SSO provider configurations.
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { authComponent } from '../auth';

export const getByOrganization = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('ssoProviders'),
      organizationId: v.string(),
      providerId: v.string(),
      issuer: v.string(),
      domain: v.string(),
      scopes: v.array(v.string()),
      autoProvisionEnabled: v.boolean(),
      excludeGroups: v.array(v.string()),
      teamMembershipMode: v.union(v.literal('sync'), v.literal('additive')),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const provider = await ctx.db
      .query('ssoProviders')
      .withIndex('organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    if (!provider) {
      return null;
    }

    return {
      _id: provider._id,
      organizationId: provider.organizationId,
      providerId: provider.providerId,
      issuer: provider.issuer,
      domain: provider.domain,
      scopes: provider.scopes,
      autoProvisionEnabled: provider.autoProvisionEnabled,
      excludeGroups: provider.excludeGroups,
      teamMembershipMode: provider.teamMembershipMode,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  },
});

export const getByDomain = query({
  args: {
    domain: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('ssoProviders'),
      organizationId: v.string(),
      providerId: v.string(),
      issuer: v.string(),
      domain: v.string(),
      autoProvisionEnabled: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const provider = await ctx.db
      .query('ssoProviders')
      .withIndex('domain', (q) => q.eq('domain', args.domain.toLowerCase()))
      .first();

    if (!provider) {
      return null;
    }

    return {
      _id: provider._id,
      organizationId: provider.organizationId,
      providerId: provider.providerId,
      issuer: provider.issuer,
      domain: provider.domain,
      autoProvisionEnabled: provider.autoProvisionEnabled,
    };
  },
});

/**
 * Check if SSO is configured for the deployment.
 * This is a public query (no auth required) for use on login/signup pages.
 * For single-org deployments, returns true if any SSO provider exists.
 */
export const isSsoConfigured = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    providerType: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const provider = await ctx.db.query('ssoProviders').first();

    if (!provider) {
      return { enabled: false };
    }

    return {
      enabled: true,
      providerType: provider.providerId,
    };
  },
});
