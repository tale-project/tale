'use node';

/**
 * Public catalog surface for the providers settings UI: the shipped
 * providers with their model catalogs, and the explicit user-triggered
 * catalog refresh. Both are developer-settings surfaces, gated like the
 * credential writes that sit next to them.
 *
 * Listing degrades per provider — a live catalog that cannot be fetched
 * (cold cache + endpoint down) yields an empty model list with the error
 * message attached, so one unreachable source never blanks the whole page.
 * There is no background refresh beyond the daily read-through window; the
 * refresh action here is the only way to force a refetch (a deliberate
 * design point — no scheduled merges into anything).
 */

import { v } from 'convex/values';

import { action } from '../../_generated/server';
import { requireOrgAdminOrDeveloper } from '../auth/require_org_admin_or_developer';
import { getProviderCatalog } from './catalog_fetch';
import {
  providerCatalogValidator,
  modelEntryValidator,
} from './catalog_validators';
import { readSystemEntryIcon } from './load_system_config';
import { resolveProvidersForOrgId } from './org_providers';

/**
 * Every shipped provider with its current model catalog (cached
 * live sources served read-through; static sources read from the image).
 */
export const listProviderCatalogs = action({
  args: { organizationId: v.string() },
  returns: v.array(providerCatalogValidator),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const results = [];
    for (const provider of await resolveProvidersForOrgId(
      ctx,
      args.organizationId,
    )) {
      let models: (typeof modelEntryValidator)['type'][] = [];
      let catalogError: string | undefined;
      try {
        models = [...(await getProviderCatalog(provider))];
      } catch (err) {
        catalogError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[catalog] listing for ${provider.name} unavailable:`,
          err,
        );
      }
      const iconUrl = readSystemEntryIcon('providers', provider.name);
      results.push({
        name: provider.name,
        displayName: provider.displayName,
        ...(iconUrl !== undefined && { iconUrl }),
        apiFormat: provider.apiFormat,
        ...(provider.baseUrl !== undefined && { baseUrl: provider.baseUrl }),
        ...(provider.endpointMode !== undefined && {
          endpointMode: provider.endpointMode,
        }),
        catalogSource: provider.catalog.source,
        authMethods: provider.auth.map((entry) => entry.method),
        models,
        ...(catalogError !== undefined && { catalogError }),
      });
    }
    return results;
  },
});

/**
 * Force-refresh the live-source catalogs now (static sources have nothing to
 * refresh). Returns the per-provider outcome so the UI can report exactly
 * which sources updated and which failed.
 */
export const refreshProviderCatalogs = action({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      name: v.string(),
      modelCount: v.number(),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const results = [];
    for (const provider of await resolveProvidersForOrgId(
      ctx,
      args.organizationId,
    )) {
      if (
        provider.catalog.source === 'static' ||
        provider.catalog.source === 'none'
      ) {
        continue;
      }
      try {
        const entries = await getProviderCatalog(provider, {
          forceRefresh: true,
        });
        results.push({ name: provider.name, modelCount: entries.length });
      } catch (err) {
        results.push({
          name: provider.name,
          modelCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  },
});
