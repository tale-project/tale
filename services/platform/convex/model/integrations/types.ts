/**
 * Type definitions for integration operations
 */

import type { Infer } from 'convex/values';
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
