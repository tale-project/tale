import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { getTrustedAuthData } from '../lib/rls/auth/get_trusted_auth_data';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

const GLOBAL_BINDING_KEY = 'global';

async function requireBrandingAdmin(ctx: MutationCtx): Promise<void> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');

  const trustedData = await getTrustedAuthData(ctx);
  if (trustedData) {
    if (!isAdmin(trustedData.trustedRole)) {
      throw new Error('Only admins can modify branding');
    }
    return;
  }

  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 10 },
    where: [{ field: 'userId', value: authUser.userId, operator: 'eq' }],
  });
  for (const member of memberRes?.page ?? []) {
    if (typeof member.role === 'string' && isAdmin(member.role)) return;
  }
  throw new Error('Only admins can modify branding');
}

interface UpsertBindingsArgs {
  logoStorageId?: Id<'_storage'> | null;
  faviconLightStorageId?: Id<'_storage'> | null;
  faviconDarkStorageId?: Id<'_storage'> | null;
}

/** @deprecated Images now stored on filesystem via file_actions.saveImage. */
export async function upsertBrandingBindingsHandler(
  ctx: MutationCtx,
  args: UpsertBindingsArgs,
): Promise<null> {
  await requireBrandingAdmin(ctx);

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

/** @deprecated Images now stored on filesystem via file_actions.saveImage. */
export const upsertBrandingBindings = mutation({
  args: {
    logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    faviconLightStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    faviconDarkStorageId: v.optional(v.union(v.id('_storage'), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => upsertBrandingBindingsHandler(ctx, args),
});

/** @deprecated Images now stored on filesystem via file_actions.deleteImage. */
export const clearBrandingBindings = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireBrandingAdmin(ctx);

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
