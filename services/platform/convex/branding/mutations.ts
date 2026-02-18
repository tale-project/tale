import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { ADMIN_ONLY, validateOrganizationAccess } from '../lib/rls';

interface UpsertBrandingArgs {
  organizationId: string;
  appName?: string;
  textLogo?: string;
  logoStorageId?: Id<'_storage'>;
  faviconLightStorageId?: Id<'_storage'>;
  faviconDarkStorageId?: Id<'_storage'>;
  brandColor?: string;
  accentColor?: string;
}

export async function upsertBrandingHandler(
  ctx: MutationCtx,
  args: UpsertBrandingArgs,
): Promise<null> {
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

  const { organizationId: _, ...brandingFields } = args;
  const now = Date.now();

  if (existing) {
    if (
      args.logoStorageId !== undefined &&
      existing.logoStorageId &&
      args.logoStorageId !== existing.logoStorageId
    ) {
      await ctx.storage.delete(existing.logoStorageId);
    }
    if (
      args.faviconLightStorageId !== undefined &&
      existing.faviconLightStorageId &&
      args.faviconLightStorageId !== existing.faviconLightStorageId
    ) {
      await ctx.storage.delete(existing.faviconLightStorageId);
    }
    if (
      args.faviconDarkStorageId !== undefined &&
      existing.faviconDarkStorageId &&
      args.faviconDarkStorageId !== existing.faviconDarkStorageId
    ) {
      await ctx.storage.delete(existing.faviconDarkStorageId);
    }

    await ctx.db.patch(existing._id, {
      ...brandingFields,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('brandingSettings', {
      organizationId: args.organizationId,
      ...brandingFields,
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
    logoStorageId: v.optional(v.id('_storage')),
    faviconLightStorageId: v.optional(v.id('_storage')),
    faviconDarkStorageId: v.optional(v.id('_storage')),
    brandColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => upsertBrandingHandler(ctx, args),
});
