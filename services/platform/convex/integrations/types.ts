/**
 * Type definitions for integration operations
 */

import type { Infer } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import {
  apiKeyAuthEncryptedValidator,
  apiKeyAuthValidator,
  authMethodValidator,
  basicAuthEncryptedValidator,
  basicAuthValidator,
  capabilitiesValidator,
  connectionConfigValidator,
  connectorConfigValidator,
  connectorOperationValidator,
  integrationTypeValidator,
  oauth2AuthEncryptedValidator,
  oauth2AuthValidator,
  operationTypeValidator,
  sqlConnectionConfigValidator,
  sqlEngineValidator,
  sqlOperationValidator,
  statusValidator,
  testConnectionResultValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type IntegrationType = Infer<typeof integrationTypeValidator>;
export type AuthMethod = Infer<typeof authMethodValidator>;
export type Status = Infer<typeof statusValidator>;
export type OperationType = Infer<typeof operationTypeValidator>;
export type SqlEngine = Infer<typeof sqlEngineValidator>;

export type ApiKeyAuth = Infer<typeof apiKeyAuthValidator>;
export type ApiKeyAuthEncrypted = Infer<typeof apiKeyAuthEncryptedValidator>;
export type BasicAuth = Infer<typeof basicAuthValidator>;
export type BasicAuthEncrypted = Infer<typeof basicAuthEncryptedValidator>;
export type OAuth2Auth = Infer<typeof oauth2AuthValidator>;
export type OAuth2AuthEncrypted = Infer<typeof oauth2AuthEncryptedValidator>;

export type ConnectionConfig = Infer<typeof connectionConfigValidator>;
export type Capabilities = Infer<typeof capabilitiesValidator>;
export type ConnectorOperation = Infer<typeof connectorOperationValidator>;
export type ConnectorConfig = Infer<typeof connectorConfigValidator>;
export type SqlConnectionConfig = Infer<typeof sqlConnectionConfigValidator>;
export type SqlOperation = Infer<typeof sqlOperationValidator>;
export type TestConnectionResult = Infer<typeof testConnectionResultValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export interface DecryptedCredentials {
  name: string;
  connectionConfig?: ConnectionConfig;
  apiKey?: string;
  keyPrefix?: string;
  username?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  scopes?: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const SHOPIFY_API_VERSION = '2024-01';

// =============================================================================
// TYPED INTEGRATION INTERFACES
// =============================================================================

/**
 * Base integration type alias for Doc<'integrations'>.
 * Use the type guards below to narrow to specific integration types.
 */
export type Integration = Doc<'integrations'>;

/**
 * SQL Integration - integration with type='sql' and required SQL-specific fields.
 * Use `isSqlIntegration()` to safely narrow to this type.
 */
export interface SqlIntegration extends Integration {
  type: 'sql';
  sqlConnectionConfig: SqlConnectionConfig;
  sqlOperations: SqlOperation[];
}

/**
 * REST API Integration - integration with type='rest_api' (or undefined for legacy) and connector config.
 * Use `isRestApiIntegration()` to safely narrow to this type.
 *
 * Note: type can be undefined for backward compatibility with legacy integrations
 * that were created before the type field was added.
 */
export interface RestApiIntegration extends Integration {
  type: 'rest_api' | undefined;
  connector: ConnectorConfig;
}

