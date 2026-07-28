'use node';

/**
 * Public catalog surface for the providers settings UI: the shipped
 * connectors with their model catalogs, and the explicit user-triggered
 * catalog refresh. Both are developer-settings surfaces, gated like the
 * credential writes that sit next to them.
 *
 * Listing degrades per connector — a live catalog that cannot be fetched
 * (cold cache + endpoint down) yields an empty model list with the error
 * message attached, so one unreachable source never blanks the whole page.
 * There is no background refresh beyond the daily read-through window; the
 * refresh action here is the only way to force a refetch (a deliberate
 * design point — no scheduled merges into anything).
 */

import { v } from 'convex/values';

import { action } from '../../_generated/server';
import { requireOrgAdminOrDeveloper } from '../auth/require_org_admin_or_developer';
import { getConnectorCatalog } from './catalog_fetch';
import {
  connectorCatalogValidator,
  modelEntryValidator,
} from './catalog_validators';
import { readSystemEntryIcon } from './load_system_config';
import { resolveConnectorsForOrgId } from './org_connectors';

/**
 * Every shipped provider connector with its current model catalog (cached
 * live sources served read-through; static sources read from the image).
 */
export const listProviderCatalogs = action({
  args: { organizationId: v.string() },
  returns: v.array(connectorCatalogValidator),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const results = [];
    for (const connector of await resolveConnectorsForOrgId(
      ctx,
      args.organizationId,
    )) {
      let models: (typeof modelEntryValidator)['type'][] = [];
      let catalogError: string | undefined;
      try {
        models = [...(await getConnectorCatalog(connector))];
      } catch (err) {
        catalogError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[catalog] listing for ${connector.name} unavailable:`,
          err,
        );
      }
      const iconUrl = readSystemEntryIcon('providers', connector.name);
      results.push({
        name: connector.name,
        displayName: connector.displayName,
        ...(iconUrl !== undefined && { iconUrl }),
        apiFormat: connector.apiFormat,
        ...(connector.baseUrl !== undefined && { baseUrl: connector.baseUrl }),
        ...(connector.endpointMode !== undefined && {
          endpointMode: connector.endpointMode,
        }),
        catalogSource: connector.catalog.source,
        authMethods: connector.auth.map((entry) => entry.method),
        models,
        ...(catalogError !== undefined && { catalogError }),
      });
    }
    return results;
  },
});

/**
 * Force-refresh the live-source catalogs now (static sources have nothing to
 * refresh). Returns the per-connector outcome so the UI can report exactly
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
    for (const connector of await resolveConnectorsForOrgId(
      ctx,
      args.organizationId,
    )) {
      if (
        connector.catalog.source === 'static' ||
        connector.catalog.source === 'none'
      ) {
        continue;
      }
      try {
        const entries = await getConnectorCatalog(connector, {
          forceRefresh: true,
        });
        results.push({ name: connector.name, modelCount: entries.length });
      } catch (err) {
        results.push({
          name: connector.name,
          modelCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  },
});
