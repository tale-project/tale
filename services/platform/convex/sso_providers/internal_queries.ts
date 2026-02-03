/**
 * SSO Providers Internal Queries
 *
 * Internal queries for SSO provider operations.
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { authComponent } from '../auth';
import { components } from '../_generated/api';

export const getAuthUser = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      _id: v.string(),
      email: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }
    return {
      _id: String(authUser._id),
      email: authUser.email,
      name: authUser.name ?? '',
    };
  },
});

export const getCallerRole = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: args.userId, operator: 'eq' },
      ],
    });

    const member = memberRes?.page?.[0] as { role?: string } | undefined;
    return member?.role?.toLowerCase() ?? null;
  },
});

export const getSsoConfigByDomain = internalQuery({
  args: {
    domain: v.string(),
  },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      autoProvisionEnabled: v.boolean(),
      excludeGroups: v.array(v.string()),
      teamMembershipMode: v.union(v.literal('sync'), v.literal('additive')),
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
      organizationId: provider.organizationId,
      autoProvisionEnabled: provider.autoProvisionEnabled,
      excludeGroups: provider.excludeGroups,
      teamMembershipMode: provider.teamMembershipMode,
    };
  },
});

export const getUserById = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.union(
    v.object({
      email: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'id', value: args.userId, operator: 'eq' }],
    });

    const user = userRes?.page?.[0] as { email?: string } | undefined;
    if (!user?.email) {
      return null;
    }

    return { email: user.email };
  },
});

export const getFullSsoConfig = internalQuery({
  args: {
    domain: v.string(),
  },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      providerId: v.string(),
      issuer: v.string(),
      domain: v.string(),
      clientIdEncrypted: v.string(),
      clientSecretEncrypted: v.string(),
      scopes: v.array(v.string()),
      autoProvisionEnabled: v.boolean(),
      excludeGroups: v.array(v.string()),
      teamMembershipMode: v.union(v.literal('sync'), v.literal('additive')),
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
      organizationId: provider.organizationId,
      providerId: provider.providerId,
      issuer: provider.issuer,
      domain: provider.domain,
      clientIdEncrypted: provider.clientIdEncrypted,
      clientSecretEncrypted: provider.clientSecretEncrypted,
      scopes: provider.scopes,
      autoProvisionEnabled: provider.autoProvisionEnabled,
      excludeGroups: provider.excludeGroups,
      teamMembershipMode: provider.teamMembershipMode,
    };
  },
});

/**
 * Get the first SSO provider configuration.
 * Used for single-organization deployments where only one provider exists.
 */
export const getFirstSsoProvider = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      organizationId: v.string(),
      providerId: v.string(),
      issuer: v.string(),
      domain: v.string(),
      clientIdEncrypted: v.string(),
      clientSecretEncrypted: v.string(),
      scopes: v.array(v.string()),
      autoProvisionEnabled: v.boolean(),
      excludeGroups: v.array(v.string()),
      teamMembershipMode: v.union(v.literal('sync'), v.literal('additive')),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const provider = await ctx.db.query('ssoProviders').first();

    if (!provider) {
      return null;
    }

    return {
      organizationId: provider.organizationId,
      providerId: provider.providerId,
      issuer: provider.issuer,
      domain: provider.domain,
      clientIdEncrypted: provider.clientIdEncrypted,
      clientSecretEncrypted: provider.clientSecretEncrypted,
      scopes: provider.scopes,
      autoProvisionEnabled: provider.autoProvisionEnabled,
      excludeGroups: provider.excludeGroups,
      teamMembershipMode: provider.teamMembershipMode,
    };
  },
});
