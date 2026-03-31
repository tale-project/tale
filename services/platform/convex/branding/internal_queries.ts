import { internalQuery } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';

const GLOBAL_BINDING_KEY = 'global';

export const getBindingsWithUrls = internalQuery({
  args: {},
  handler: async (ctx) => {
    const binding = await ctx.db
      .query('brandingBindings')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', GLOBAL_BINDING_KEY),
      )
      .first();

    if (!binding) return null;

    async function safeGetUrl(storageId: string | undefined) {
      if (!storageId) return null;
      try {
        const url = await ctx.storage.getUrl(storageId);
        return url ? toPublicUrl(url) : null;
      } catch (error) {
        console.warn(
          '[Branding] Failed to resolve storage URL',
          storageId,
          error,
        );
        return null;
      }
    }

    const [logoUrl, faviconLightUrl, faviconDarkUrl] = await Promise.all([
      safeGetUrl(binding.logoStorageId),
      safeGetUrl(binding.faviconLightStorageId),
      safeGetUrl(binding.faviconDarkStorageId),
    ]);

    return { logoUrl, faviconLightUrl, faviconDarkUrl };
  },
});
