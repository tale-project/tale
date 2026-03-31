import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';

const GLOBAL_BINDING_KEY = 'global';

interface UpsertBindingsArgs {
  logoStorageId?: Id<'_storage'> | null;
  faviconLightStorageId?: Id<'_storage'> | null;
  faviconDarkStorageId?: Id<'_storage'> | null;
}

export async function upsertBrandingBindingsHandler(
  ctx: MutationCtx,
  args: UpsertBindingsArgs,
): Promise<null> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');

  const existing = await ctx.db
    .query('brandingBindings')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', GLOBAL_BINDING_KEY),
    )
    .first();

  const { logoStorageId, faviconLightStorageId, faviconDarkStorageId } = args;

  const storageFields = {
    ...(logoStorageId !== undefined && {
      logoStorageId: logoStorageId ?? undefined,
    }),
    ...(faviconLightStorageId !== undefined && {
      faviconLightStorageId: faviconLightStorageId ?? undefined,
    }),
    ...(faviconDarkStorageId !== undefined && {
      faviconDarkStorageId: faviconDarkStorageId ?? undefined,
    }),
  };

  if (existing) {
    if (
      logoStorageId !== undefined &&
      existing.logoStorageId &&
      logoStorageId !== existing.logoStorageId
    ) {
      await ctx.storage.delete(existing.logoStorageId);
    }
    if (
      faviconLightStorageId !== undefined &&
      existing.faviconLightStorageId &&
      faviconLightStorageId !== existing.faviconLightStorageId
    ) {
      await ctx.storage.delete(existing.faviconLightStorageId);
    }
    if (
      faviconDarkStorageId !== undefined &&
      existing.faviconDarkStorageId &&
      faviconDarkStorageId !== existing.faviconDarkStorageId
    ) {
      await ctx.storage.delete(existing.faviconDarkStorageId);
    }

    await ctx.db.patch(existing._id, storageFields);
  } else {
    await ctx.db.insert('brandingBindings', {
      organizationId: GLOBAL_BINDING_KEY,
      ...storageFields,
    });
  }

  return null;
}

export const upsertBrandingBindings = mutation({
  args: {
    logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    faviconLightStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    faviconDarkStorageId: v.optional(v.union(v.id('_storage'), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => upsertBrandingBindingsHandler(ctx, args),
});

export const clearBrandingBindings = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const existing = await ctx.db
      .query('brandingBindings')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', GLOBAL_BINDING_KEY),
      )
      .first();

    if (existing) {
      if (existing.logoStorageId) {
        await ctx.storage.delete(existing.logoStorageId);
      }
      if (existing.faviconLightStorageId) {
        await ctx.storage.delete(existing.faviconLightStorageId);
      }
      if (existing.faviconDarkStorageId) {
        await ctx.storage.delete(existing.faviconDarkStorageId);
      }
      await ctx.db.delete(existing._id);
    }

    return null;
  },
});
