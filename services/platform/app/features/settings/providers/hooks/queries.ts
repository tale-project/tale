import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import type { ItemOf } from '@/app/lib/backend/contract';

/**
 * Read hooks for the AI-providers settings page. Credentials come from a
 * reactive Convex query (masked by construction — the server never selects
 * ciphertext), so writes through the credential mutations/actions propagate
 * without manual invalidation. The provider catalogs come from a Convex
 * ACTION (it reads shipped config files and cached live catalogs), so it goes
 * through `useActionQuery`; the explicit catalog refresh invalidates its key.
 */

/** One masked credential row as listed for the settings page. */
export type MaskedCredential =
  ItemOf<'provider_credentials/queries:listCredentials'>;

/** One shipped provider with its current model catalog. */
export type ProviderCatalog =
  ItemOf<'lib/providers/catalog_actions:listProviderCatalogs'>;

/** One model entry of a provider's catalog. */
export type CatalogModel = ProviderCatalog['models'][number];

/** React-query key of the catalog listing — shared with the refresh hook. */
export function providerCatalogsQueryKey(organizationId: string) {
  return ['providers', 'catalogs', organizationId] as const;
}

/** Every provider credential of the organization, masked. */
export function useProviderCredentials(organizationId: string) {
  return useConvexQuery('provider_credentials/queries:listCredentials', {
    organizationId,
  });
}

/** Every shipped provider with its model catalog (may carry a per-provider
 * `catalogError` when a live source is unreachable). */
export function useProviderCatalogs(organizationId: string) {
  return useActionQuery(
    providerCatalogsQueryKey(organizationId),
    'lib/providers/catalog_actions:listProviderCatalogs',
    { organizationId },
  );
}

/** One shipped harness with its resolved status for this org. */
export type HarnessStatus =
  ItemOf<'lib/providers/harness_status:listHarnessStatus'>;

/** React-query key of the harness status listing. */
export function harnessStatusQueryKey(organizationId: string) {
  return ['providers', 'harness-status', organizationId] as const;
}

/** How each shipped harness would run for this org — resolved server-side
 * from the credentials and harness facts. */
export function useHarnessStatus(organizationId: string) {
  return useActionQuery(
    harnessStatusQueryKey(organizationId),
    'lib/providers/harness_status:listHarnessStatus',
    { organizationId },
  );
}

/** Per-harness recent-failure signal — the same reactive health read the
 * chat composer's circuit-breaker hint consumes. */
export function useHarnessHealth(organizationId: string) {
  return useConvexQuery('sandbox/session_queries_public:getHarnessHealth', {
    organizationId,
  });
}
