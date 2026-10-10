import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';

import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { getProviderCatalog } from '../../core/lib/providers/catalog_fetch.ts';
import { resolveProvidersForOrg } from '../../core/lib/providers/org_providers.ts';
import { resolveCatalogBearer } from '../provider_credentials/service.ts';

/**
 * Who manages an organization's AI providers, and the refresh of their
 * model catalogs. The AI providers page's door (`routes.ts`) gates every
 * provider setting on `mayManageProviders`, and every other caller that
 * reads or changes a provider asks the same question.
 */

/** Whether a role may manage the organization's AI providers — their
 * definitions, catalogs and credentials: an owner, admin or developer. */
export function mayManageProviders(role: string): boolean {
  return isAdminOrDeveloperRole(role);
}

/** One provider's refreshed catalog: how many models it lists now, or why
 * it could not be read. */
export interface CatalogRefreshResult {
  readonly name: string;
  readonly modelCount: number;
  readonly error?: string;
}

/**
 * Fetch afresh the model catalog of every provider the organization
 * resolves whose models come from a live source — a static list or none
 * has nothing to refresh — with the organization's listing key for it,
 * when it holds one. A provider whose catalog cannot be fetched reads as
 * zero models with the reason; the others still refresh.
 */
export async function refreshProviderCatalogs(
  sql: Sql,
  org: { readonly organizationId: string; readonly orgSlug: string },
): Promise<CatalogRefreshResult[]> {
  const results: CatalogRefreshResult[] = [];
  for (const provider of resolveProvidersForOrg(org.orgSlug)) {
    if (hasLiveCatalog(provider)) {
      results.push(await refreshProviderCatalog(sql, org, provider));
    }
  }
  return results;
}

/** Whether a provider's models come from a live source a refresh reads
 * again; a static list or none has nothing to refresh. */
export function hasLiveCatalog(provider: ProviderDefinition): boolean {
  return (
    provider.catalog.source !== 'static' && provider.catalog.source !== 'none'
  );
}

/**
 * Fetch one provider's model catalog afresh, with the organization's
 * listing key for it when it holds one: how many models it lists now, or
 * why it could not be read.
 */
export async function refreshProviderCatalog(
  sql: Sql,
  org: { readonly organizationId: string },
  provider: ProviderDefinition,
): Promise<CatalogRefreshResult> {
  try {
    const bearerToken = await resolveCatalogBearer(
      sql,
      org.organizationId,
      provider,
    );
    const entries = await getProviderCatalog(provider, {
      forceRefresh: true,
      ...(bearerToken !== undefined ? { bearerToken } : {}),
    });
    return { name: provider.name, modelCount: entries.length };
  } catch (error) {
    return {
      name: provider.name,
      modelCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
