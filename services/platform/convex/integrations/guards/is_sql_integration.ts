import type { Integration, SqlIntegration } from '../types';

/**
 * Type guard to check if an integration is an SQL integration.
 * Narrows the type to SqlIntegration when true.
 *
 * @example
 * if (isSqlIntegration(integration)) {
 *   // integration.sqlConnectionConfig is now typed
 *   const engine = integration.sqlConnectionConfig.engine;
 * }
 */
export function isSqlIntegration(
  integration: Integration,
): integration is SqlIntegration {
  return (
    integration.type === 'sql' &&
    integration.sqlConnectionConfig !== undefined &&
    integration.sqlOperations !== undefined
  );
}
