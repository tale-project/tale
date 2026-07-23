import type { FunctionReturnType } from 'convex/server';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * Read hooks for the AI-providers settings page. Credentials come from a
 * reactive Convex query (masked by construction — the server never selects
 * ciphertext), so writes through the credential mutations/actions propagate
 * without manual invalidation. The connector catalogs come from a Convex
 * ACTION (it reads shipped config files and cached live catalogs), so it goes
 * through `useActionQuery`; the explicit catalog refresh invalidates its key.
 */

/** One masked credential row as listed for the settings page. */
export type MaskedCredential = FunctionReturnType<
  typeof api.provider_credentials.queries.listCredentials
>[number];

/** One shipped connector with its current model catalog. */
export type ConnectorCatalog = FunctionReturnType<
  typeof api.lib.providers.catalog_actions.listProviderCatalogs
>[number];

/** One model entry of a connector's catalog. */
export type CatalogModel = ConnectorCatalog['models'][number];

/** React-query key of the catalog listing — shared with the refresh hook. */
export function providerCatalogsQueryKey(organizationId: string) {
  return ['providers', 'catalogs', organizationId] as const;
}

/** Every provider credential of the organization, masked. */
export function useProviderCredentials(organizationId: string) {
  return useConvexQuery(api.provider_credentials.queries.listCredentials, {
    organizationId,
  });
}

/** Every shipped connector with its model catalog (may carry a per-connector
 * `catalogError` when a live source is unreachable). */
export function useProviderCatalogs(organizationId: string) {
  return useActionQuery(
    providerCatalogsQueryKey(organizationId),
    api.lib.providers.catalog_actions.listProviderCatalogs,
    { organizationId },
  );
}
