import { v } from 'convex/values';

import type { QueryCtx } from '../_generated/server';
import type { AuthenticatedUser } from '../lib/rls/types';

import { query } from '../_generated/server';
import { getAuthUserIdentity, validateOrganizationAccess } from '../lib/rls';

export async function getBrandingHandler(
  ctx: QueryCtx,
  args: { organizationId: string },
  user?: AuthenticatedUser,
) {
  await validateOrganizationAccess(ctx, args.organizationId, undefined, user);

  const branding = await ctx.db
    .query('brandingSettings')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  if (!branding) return null;

  const [logoUrl, faviconLightUrl, faviconDarkUrl] = await Promise.all([
    branding.logoStorageId ? ctx.storage.getUrl(branding.logoStorageId) : null,
    branding.faviconLightStorageId
      ? ctx.storage.getUrl(branding.faviconLightStorageId)
      : null,
    branding.faviconDarkStorageId
      ? ctx.storage.getUrl(branding.faviconDarkStorageId)
      : null,
  ]);

  return {
    appName: branding.appName,
    textLogo: branding.textLogo,
    logoUrl,
    faviconLightUrl,
    faviconDarkUrl,
    brandColor: branding.brandColor,
    accentColor: branding.accentColor,
  };
}

export const getBranding = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(
    v.object({
      appName: v.optional(v.string()),
      textLogo: v.optional(v.string()),
      logoUrl: v.union(v.string(), v.null()),
      faviconLightUrl: v.union(v.string(), v.null()),
      faviconDarkUrl: v.union(v.string(), v.null()),
      brandColor: v.optional(v.string()),
      accentColor: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    return getBrandingHandler(ctx, args, authUser);
  },
});
