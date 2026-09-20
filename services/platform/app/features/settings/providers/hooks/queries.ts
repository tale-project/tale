import { useActionQuery } from '@/app/hooks/use-action-query';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import type { ItemOf } from '@/app/lib/backend/contract';
import { backendKey } from '@/app/lib/backend/query-keys';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

/**
 * Read hooks for the AI-providers settings page. Credentials are masked by
 * construction (the server never selects ciphertext) and key under the
 * provider-credential entity, as does every read derived from them: a
 * credential write invalidates that entity in this tab and the backend hints
 * it to every other session. The provider catalogs are read from the shipped
 * config files and the cached live catalogs — no credential changes them — so
 * only the explicit catalog refresh invalidates their key.
 */

/** One masked credential row as listed for the settings page. */
export type MaskedCredential =
  ItemOf<'provider_credentials/queries:listCredentials'>;

/** One shipped provider with its current model catalog. */
export type ProviderCatalog =
  ItemOf<'lib/providers/catalog_actions:listProviderCatalogs'>;

/** One model entry of a provider's catalog. */
export type CatalogModel = ProviderCatalog['models'][number];

/** React-query key of the catalog listing — shared by every catalog read and
 * the refresh hook, so one refresh reaches them all. */
export function providerCatalogsQueryKey(organizationId: string) {
  return ['providers', 'catalogs', organizationId] as const;
}

/** Every provider credential of the organization, masked. */
export function useProviderCredentials(organizationId: string) {
  return useBackendQuery('provider_credentials/queries:listCredentials', {
    organizationId,
  });
}

/** Every shipped provider with its model catalog (may carry a per-provider
 * `catalogError` when a live source is unreachable). A reader that only
 * needs the catalogs in some states (the embedding form, editable only)
 * passes `enabled` — the key stays shared, so one fetch serves every page. */
export function useProviderCatalogs(
  organizationId: string,
  options?: { enabled?: boolean },
) {
  return useActionQuery(
    providerCatalogsQueryKey(organizationId),
    'lib/providers/catalog_actions:listProviderCatalogs',
    { organizationId },
    options,
  );
}

/** React-query prefix of every custom-definition read of the organization —
 * what a save or delete invalidates. */
export function providerDefinitionsQueryPrefix(organizationId: string) {
  return ['providers', 'definition', organizationId] as const;
}

/** One shipped harness with its resolved status for this org. */
export type HarnessStatus =
  ItemOf<'lib/providers/harness_status:listHarnessStatus'>;

/** React-query key of the harness status listing. The status is resolved
 * from the credentials, so it keys under their entity: adding the first key
 * flips the section from "no usable credential" without a reload. */
function harnessStatusQueryKey(organizationId: string) {
  return backendKey(
    organizationId,
    PROVIDER_CREDENTIAL_HINT_ENTITY,
    'harness-status',
  );
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
  return useBackendQuery('sandbox/session_queries_public:getHarnessHealth', {
    organizationId,
  });
}
