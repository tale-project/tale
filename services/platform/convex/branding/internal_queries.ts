import { internalQuery, type QueryCtx } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';

/**
 * Resolve a storage id to a public URL, surfacing failures at warn level so a
 * stale/broken storage reference is visible in logs instead of silently
 * collapsing to `null`.
 */
async function safeGetPublicUrl(
  ctx: QueryCtx,
  storageId: string | undefined,
): Promise<string | null> {
  if (!storageId) return null;
  try {
    const url = await ctx.storage.getUrl(storageId);
    return url ? toPublicUrl(url) : null;
  } catch (error) {
    console.warn(
      '[Branding] legacy storage URL resolve failed',
      storageId,
      error,
    );
    return null;
  }
}

export const getLegacyBranding = internalQuery({
  args: {},
  handler: async (ctx) => {
    const legacy = await ctx.db.query('brandingSettings').first();
    if (!legacy) return null;

    const [logoUrl, faviconLightUrl, faviconDarkUrl] = await Promise.all([
      safeGetPublicUrl(ctx, legacy.logoStorageId),
      safeGetPublicUrl(ctx, legacy.faviconLightStorageId),
      safeGetPublicUrl(ctx, legacy.faviconDarkStorageId),
    ]);

    return {
      appName: legacy.appName,
      textLogo: legacy.textLogo,
      brandColor: legacy.brandColor,
      accentColor: legacy.accentColor,
      logoUrl,
      faviconLightUrl,
      faviconDarkUrl,
    };
  },
});
