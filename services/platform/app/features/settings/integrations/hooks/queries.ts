import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

import { listConnectorsRef } from './backend';

/**
 * Read hooks for the integrations settings page. Credentials come from a
 * reactive Convex query (masked by construction — the server never selects
 * ciphertext), so the writes next door propagate without manual invalidation.
 * The connector catalog comes from an ACTION (it reads the shipped connector
 * files from disk), so it goes through `useActionQuery`.
 */

/** Every shipped connector, with its icon, tags, and action count. */
export function useIntegrationConnectors(organizationId: string) {
  return useActionQuery(
    ['integrations', 'connectors', organizationId],
    listConnectorsRef,
    { organizationId },
  );
}

/** Every integration credential of the organization, masked. */
export function useIntegrationCredentials(organizationId: string) {
  return useConvexQuery(api.integration_credentials.queries.listCredentials, {
    organizationId,
  });
}
