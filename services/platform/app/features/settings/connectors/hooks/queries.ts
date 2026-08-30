import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';

/**
 * Read hooks for the connectors settings page. Credentials come from a
 * reactive Convex query (masked by construction — the server never selects
 * ciphertext), so the writes next door propagate without manual invalidation.
 * The connector catalog comes from an ACTION (it reads the shipped connector
 * files from disk), so it goes through `useActionQuery`.
 */

/** Every shipped connector, with its icon, tags, and action count. */
export function useConnectors(organizationId: string) {
  return useActionQuery(
    ['connectors', 'connectors', organizationId],
    'connector_credentials/connector_catalog:listConnectors',
    { organizationId },
  );
}

/** Every connector credential of the organization, masked. */
export function useConnectorCredentials(organizationId: string) {
  return useConvexQuery('connector_credentials/queries:listCredentials', {
    organizationId,
  });
}
