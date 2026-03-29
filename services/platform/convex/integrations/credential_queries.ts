import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalQuery, query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { UnauthorizedError } from '../lib/rls/errors';

export const getBySlug = query({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) return null;
      throw error;
    }

    return await ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', args.slug),
      )
      .first();
  },
});

export const list = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) return [];
      throw error;
    }

    const credentials = [];
    for await (const cred of ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      credentials.push(cred);
    }
    return credentials;
  },
});

export const getBySlugInternal = internalQuery({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', args.slug),
      )
      .first();
  },
});

export const getByIdInternal = internalQuery({
  args: {
    credentialId: v.id('integrationCredentials'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.credentialId);
  },
});

export const verifyCredentialAccess = internalQuery({
  args: {
    credentialId: v.id('integrationCredentials'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const cred = await ctx.db.get(args.credentialId);
    if (!cred) return null;

    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        {
          field: 'organizationId',
          value: cred.organizationId,
          operator: 'eq',
        },
        { field: 'userId', value: args.userId, operator: 'eq' },
      ],
    });

    if (!result || result.page.length === 0) return null;
    return cred;
  },
});

export const listInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const credentials = [];
    for await (const cred of ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      credentials.push(cred);
    }
    return credentials;
  },
});
