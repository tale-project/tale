import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { HEX_COLOR_REGEX } from '../../lib/shared/schemas/branding';
import { mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { ADMIN_ONLY, validateOrganizationAccess } from '../lib/rls';

interface UpsertBrandingArgs {
  organizationId: string;
  appName?: string;
  textLogo?: string;
  logoStorageId?: Id<'_storage'> | null;
  faviconLightStorageId?: Id<'_storage'> | null;
  faviconDarkStorageId?: Id<'_storage'> | null;
  brandColor?: string;
  accentColor?: string;
}

export async function upsertBrandingHandler(
  ctx: MutationCtx,
  args: UpsertBrandingArgs,
): Promise<null> {
  if (args.brandColor && !HEX_COLOR_REGEX.test(args.brandColor)) {
    throw new Error('Invalid brandColor: must be a hex color (e.g. #FF0000)');
  }
  if (args.accentColor && !HEX_COLOR_REGEX.test(args.accentColor)) {
    throw new Error('Invalid accentColor: must be a hex color (e.g. #FF0000)');
  }

  const rlsContext = await validateOrganizationAccess(
    ctx,
    args.organizationId,
    ADMIN_ONLY,
  );

  const existing = await ctx.db
    .query('brandingSettings')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  const {
    organizationId: _,
    logoStorageId,
    faviconLightStorageId,
    faviconDarkStorageId,
    ...restFields
  } = args;
  const now = Date.now();

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

    await ctx.db.patch(existing._id, {
      ...restFields,
      ...storageFields,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('brandingSettings', {
      organizationId: args.organizationId,
      ...restFields,
      ...storageFields,
      updatedAt: now,
    });
  }

  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: args.organizationId,
      actor: {
        id: rlsContext.user.userId,
        email: rlsContext.user.email,
        role: rlsContext.role,
        type: 'user',
      },
    },
    existing ? 'update_branding' : 'create_branding',
    'admin',
    'branding',
    args.organizationId,
    'Branding settings',
    existing
      ? {
          appName: existing.appName,
          textLogo: existing.textLogo,
          brandColor: existing.brandColor,
          accentColor: existing.accentColor,
        }
      : undefined,
    {
      appName: args.appName,
      textLogo: args.textLogo,
      brandColor: args.brandColor,
      accentColor: args.accentColor,
    },
  );

  return null;
}

export const upsertBranding = mutation({
  args: {
    organizationId: v.string(),
    appName: v.optional(v.string()),
    textLogo: v.optional(v.string()),
    logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    faviconLightStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    faviconDarkStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    brandColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => upsertBrandingHandler(ctx, args),
});
