import type { Integration, RestApiIntegration } from '../types';

/**
 * Type guard to check if an integration is a REST API integration with connector.
 * Narrows the type to RestApiIntegration when true.
 *
 * @example
 * if (isRestApiIntegration(integration)) {
 *   // integration.connector is now typed
 *   const operations = integration.connector.operations;
 * }
 */
export function isRestApiIntegration(
  integration: Integration,
): integration is RestApiIntegration {
  return (
    // Accept undefined type for backward compatibility with legacy integrations
    (integration.type === 'rest_api' || integration.type === undefined) &&
    integration.connector !== undefined
  );
}
