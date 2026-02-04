/**
 * Email Providers Public Mutations
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { deleteProvider as deleteProviderHelper } from './delete_provider';
import { updateProvider as updateProviderHelper } from './update_provider';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

export const deleteProvider = mutation({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error('Email provider not found');
    }
    if (!provider.organizationId) {
      throw new Error('Email provider has no organization');
    }

    await getOrganizationMember(ctx, provider.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await deleteProviderHelper(ctx, args);
  },
});

export const setDefault = mutation({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error('Email provider not found');
    }
    if (!provider.organizationId) {
      throw new Error('Email provider has no organization');
    }

    await getOrganizationMember(ctx, provider.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    for await (const p of ctx.db
      .query('emailProviders')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', provider.organizationId),
      )) {
      if (p.isDefault && p._id !== args.providerId) {
        await ctx.db.patch(p._id, { isDefault: false });
      }
    }

    await ctx.db.patch(args.providerId, { isDefault: true });

    return { success: true };
  },
});

export const updateProvider = mutation({
  args: {
    providerId: v.id('emailProviders'),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error('Email provider not found');
    }
    if (!provider.organizationId) {
      throw new Error('Email provider has no organization');
    }

    await getOrganizationMember(ctx, provider.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await updateProviderHelper(ctx, args);
  },
});
