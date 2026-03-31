import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

const GLOBAL_BINDING_KEY = 'global';

export const isCallerAdmin = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const memberRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 10 },
        where: [{ field: 'userId', value: args.userId, operator: 'eq' }],
      },
    );
    for (const member of memberRes?.page ?? []) {
      if (typeof member.role === 'string' && isAdmin(member.role)) return true;
    }
    return false;
  },
});

export const getLegacyBranding = internalQuery({
  args: {},
  handler: async (ctx) => {
    const legacy = await ctx.db.query('brandingSettings').first();
    if (!legacy) return null;

    async function safeGetUrl(storageId: string | undefined) {
      if (!storageId) return null;
      try {
        const url = await ctx.storage.getUrl(storageId);
        return url ? toPublicUrl(url) : null;
      } catch {
        return null;
      }
    }

    const [logoUrl, faviconLightUrl, faviconDarkUrl] = await Promise.all([
      safeGetUrl(legacy.logoStorageId),
      safeGetUrl(legacy.faviconLightStorageId),
      safeGetUrl(legacy.faviconDarkStorageId),
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

/** @deprecated Images now stored on filesystem. Retained for backward compatibility. */
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
