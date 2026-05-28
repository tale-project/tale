import { v } from 'convex/values';

import { getString, isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

const GLOBAL_BINDING_KEY = 'global';
const DEFAULT_ORG_SLUG = 'default';

/**
 * Branding is pinned to the `default` org (see `branding/file_actions.ts`
 * doc comment) — so admin authority over branding must require admin role
 * IN THE DEFAULT ORG SPECIFICALLY, not "admin in any org". Without this
 * narrowing, an admin in any user-created org could mutate the platform's
 * global branding.
 */
export const isCallerAdmin = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const orgRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'organization',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'slug', value: DEFAULT_ORG_SLUG, operator: 'eq' }],
    });
    const orgRow = orgRes?.page?.[0];
    if (!isRecord(orgRow)) return false;
    const defaultOrgId = getString(orgRow, '_id');
    if (!defaultOrgId) return false;

    const memberRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'userId', value: args.userId, operator: 'eq' },
          { field: 'organizationId', value: defaultOrgId, operator: 'eq' },
        ],
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
      } catch (error) {
        // Symmetry with `getBindingsWithUrls.safeGetUrl` below — surface
        // the storage-resolve failure at warn level instead of silently
        // returning null. An empty catch here used to hide stale
        // storage references that would have been visible in logs.
        console.warn(
          '[Branding] legacy storage URL resolve failed',
          storageId,
          error,
        );
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
