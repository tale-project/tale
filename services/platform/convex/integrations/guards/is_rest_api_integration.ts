import type { ConnectorConfig } from '../types';

/**
 * Structural type for integration-like objects that may be REST API integrations.
 * Accepts both Doc<'integrations'> and LoadedIntegration.
 */
interface IntegrationLike {
  type?: string;
  connector?: ConnectorConfig;
}

type NarrowedRestApiIntegration<T extends IntegrationLike> = T & {
  type: 'rest_api' | undefined;
  connector: ConnectorConfig;
};

/**
 * Type guard to check if an integration is a REST API integration with connector.
 * Narrows the type to include required connector fields when true.
 *
 * Accepts both Doc<'integrations'> and LoadedIntegration objects.
 *
 * @example
 * if (isRestApiIntegration(integration)) {
 *   // integration.connector is now typed
 *   const operations = integration.connector.operations;
 * }
 */
export function isRestApiIntegration<T extends IntegrationLike>(
  integration: T,
): integration is NarrowedRestApiIntegration<T> {
  return (
    (integration.type === 'rest_api' || integration.type === undefined) &&
    integration.connector !== undefined
  );
}
