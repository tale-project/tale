'use node';

/**
 * The shipped connector catalog, as this domain uses it.
 *
 * A credential is only meaningful against a connector: the connector decides
 * which auth methods exist (`auth[]`), whether each credential carries its own
 * API origin (`endpointMode`), and which `Authorization` scheme a bearer token
 * is sent under. Both the write paths (`actions.ts`) and the resolution seam
 * (`resolve_credential.ts`) read those facts from here.
 *
 * The reader itself lives in `lib/integrations/catalog.ts` and is shared with
 * the engine registry, the OAuth routes, and the settings surface, so a
 * connector cannot look valid to one of them and invalid to another. This
 * module only re-exports it under the names this domain calls.
 */

export {
  connectorBearerScheme,
  findIntegrationConnector,
  loadIntegrationConnectors,
  type LoadConnectorCatalogOptions,
} from '../../lib/integrations/catalog';
