import { useActionQuery } from '@/app/hooks/use-action-query';
import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * Read hooks for the connectors settings page. Credentials come from the
 * backend listing (masked by construction — the server never selects
 * ciphertext), keyed under the connector-credential entity: this tab's own
 * writes refresh it when they land, another session's reach it as a realtime
 * hint, and a write refused because its credential is gone refetches it.
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
  return useBackendQuery('connector_credentials/queries:listCredentials', {
    organizationId,
  });
}
