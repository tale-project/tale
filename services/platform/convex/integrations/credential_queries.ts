import { v } from 'convex/values';

import { internalQuery, query } from '../_generated/server';
import { authComponent } from '../auth';

export const getBySlug = query({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;

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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return [];

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
