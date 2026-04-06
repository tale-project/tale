import type { SqlConnectionConfig, SqlOperation } from '../types';

/**
 * Structural type for integration-like objects that may be SQL integrations.
 * Accepts both Doc<'integrations'> and LoadedIntegration.
 */
interface IntegrationLike {
  type?: string;
  sqlConnectionConfig?: SqlConnectionConfig;
  sqlOperations?: SqlOperation[];
}

/**
 * Narrowed type returned by the type guard.
 * Intersects the input type with the required SQL fields.
 */
type NarrowedSqlIntegration<T extends IntegrationLike> = T & {
  type: 'sql';
  sqlConnectionConfig: SqlConnectionConfig;
  sqlOperations: SqlOperation[];
};

/**
 * Type guard to check if an integration is an SQL integration.
 * Narrows the type to include required SQL fields when true.
 *
 * Accepts both Doc<'integrations'> and LoadedIntegration objects.
 *
 * @example
 * if (isSqlIntegration(integration)) {
 *   // integration.sqlConnectionConfig is now typed
 *   const engine = integration.sqlConnectionConfig.engine;
 * }
 */
export function isSqlIntegration<T extends IntegrationLike>(
  integration: T,
): integration is NarrowedSqlIntegration<T> {
  return (
    integration.type === 'sql' &&
    integration.sqlConnectionConfig !== undefined &&
    integration.sqlOperations !== undefined
  );
}
