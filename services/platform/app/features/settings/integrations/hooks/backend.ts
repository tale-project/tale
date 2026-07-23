import { makeFunctionReference, type FunctionReturnType } from 'convex/server';

import { api } from '@/convex/_generated/api';
import type {
  IntegrationAuthMethodName,
  IntegrationEndpointMode,
} from '@/lib/shared/schemas/integrations';

/**
 * Backend bindings of the integrations settings page.
 *
 * The credential domain is reached through the generated `api` like any other
 * surface, and the masked row type is derived from the listing query itself,
 * so this page cannot drift from what the server actually returns.
 *
 * THE ONE SEAM is the connector catalog. Reading
 * `configs/platform/system/integrations/<slug>/connector.yml` needs the
 * filesystem, and the deployment does not expose a public listing for it yet,
 * so the call is bound BY NAME — the same escape hatch the OAuth routes use
 * for their cross-module references — with the shape it is expected to return
 * declared below.
 *
 * WIRING: when the listing action lands, replace `listConnectorsRef` with its
 * `api.…` reference and derive `IntegrationConnectorSummary` from it with
 * `FunctionReturnType`. Nothing else in the feature changes. Until then this
 * one call fails and the page says so, rather than inventing a catalog.
 */

/** One stored credential as the settings listing sees it: metadata plus the
 * write-time masked preview. Secret material never leaves the server. */
export type MaskedIntegrationCredential = FunctionReturnType<
  typeof api.integration_credentials.queries.listCredentials
>[number];

/** One shipped connector as the catalog lists it. */
export interface IntegrationConnectorSummary {
  /** Connector directory name — also the `<connector>` half of an action id. */
  slug: string;
  displayName: string;
  description: string;
  /** Open-vocabulary grouping labels straight from the connector file. */
  tags: string[];
  endpointMode: IntegrationEndpointMode;
  /** The auth methods this connector accepts, in declaration order. */
  authMethods: IntegrationAuthMethodName[];
  /** How many actions the connector exposes to automations and chat. */
  actionCount: number;
  /** Served connector icon. Absent for a connector that ships none. */
  iconUrl?: string;
}

/** The shipped connectors, with their icons and action counts. An action: it
 * reads the connector files from the deployment's config tree. */
export const listConnectorsRef = makeFunctionReference<
  'action',
  { organizationId: string },
  IntegrationConnectorSummary[]
>('integration_credentials/connector_catalog:listConnectors');
