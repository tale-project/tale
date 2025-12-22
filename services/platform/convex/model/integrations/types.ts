/**
 * Type definitions for integration operations
 */

import { v } from 'convex/values';

// =============================================================================
// VALIDATORS
// =============================================================================

/**
 * Integration type validator
 */
export const integrationTypeValidator = v.union(
  v.literal('rest_api'),
  v.literal('sql'),
);

/**
 * Auth method validator
 */
export const authMethodValidator = v.union(
  v.literal('api_key'),
  v.literal('bearer_token'),
  v.literal('basic_auth'),
  v.literal('oauth2'),
);

/**
 * Status validator
 */
export const statusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
  v.literal('testing'),
);

/**
 * API key auth validator
 */
export const apiKeyAuthValidator = v.object({
  key: v.string(),
  keyPrefix: v.optional(v.string()),
});

/**
 * API key auth encrypted validator
 */
export const apiKeyAuthEncryptedValidator = v.object({
  keyEncrypted: v.string(),
  keyPrefix: v.optional(v.string()),
});

/**
 * Basic auth validator
 */
export const basicAuthValidator = v.object({
  username: v.string(),
  password: v.string(),
});

/**
 * Basic auth encrypted validator
 */
export const basicAuthEncryptedValidator = v.object({
  username: v.string(),
  passwordEncrypted: v.string(),
});

/**
 * OAuth2 auth validator
 */
export const oauth2AuthValidator = v.object({
  accessToken: v.string(),
  refreshToken: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
});

/**
 * OAuth2 auth encrypted validator
 */
export const oauth2AuthEncryptedValidator = v.object({
  accessTokenEncrypted: v.string(),
  refreshTokenEncrypted: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
});

/**
 * Connection config validator
 */
export const connectionConfigValidator = v.object({
  domain: v.optional(v.string()),
  apiVersion: v.optional(v.string()),
  apiEndpoint: v.optional(v.string()),
  timeout: v.optional(v.number()),
  rateLimit: v.optional(v.number()),
});

/**
 * Capabilities validator
 */
export const capabilitiesValidator = v.object({
  canSync: v.optional(v.boolean()),
  canPush: v.optional(v.boolean()),
  canWebhook: v.optional(v.boolean()),
  syncFrequency: v.optional(v.string()),
});

/**
 * Connector operation validator
 */
export const connectorOperationValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  parametersSchema: v.optional(v.any()),
});

/**
 * Connector config validator
 */
export const connectorConfigValidator = v.object({
  code: v.string(),
  version: v.number(),
  operations: v.array(connectorOperationValidator),
  secretBindings: v.array(v.string()),
  allowedHosts: v.optional(v.array(v.string())),
  timeoutMs: v.optional(v.number()),
});

/**
 * SQL engine validator
 */
export const sqlEngineValidator = v.union(
  v.literal('mssql'),
  v.literal('postgres'),
  v.literal('mysql'),
);

/**
 * SQL connection config validator
 */
export const sqlConnectionConfigValidator = v.object({
  engine: sqlEngineValidator,
  server: v.string(),
  port: v.optional(v.number()),
  database: v.string(),
  readOnly: v.optional(v.boolean()),
  options: v.optional(
    v.object({
      encrypt: v.optional(v.boolean()),
      trustServerCertificate: v.optional(v.boolean()),
      connectionTimeout: v.optional(v.number()),
      requestTimeout: v.optional(v.number()),
    }),
  ),
  security: v.optional(
    v.object({
      maxResultRows: v.optional(v.number()),
      queryTimeoutMs: v.optional(v.number()),
      maxConnectionPoolSize: v.optional(v.number()),
    }),
  ),
});

/**
 * SQL operation validator
 */
export const sqlOperationValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  query: v.string(),
  parametersSchema: v.optional(v.any()),
});

/**
 * Test connection result validator
 */
export const testConnectionResultValidator = v.object({
  success: v.boolean(),
  message: v.string(),
});

// =============================================================================
// TYPESCRIPT TYPES
// =============================================================================

export type IntegrationType = 'rest_api' | 'sql';
export type SqlEngine = 'mssql' | 'postgres' | 'mysql';
export type AuthMethod = 'api_key' | 'bearer_token' | 'basic_auth' | 'oauth2';
export type Status = 'active' | 'inactive' | 'error' | 'testing';

export interface ApiKeyAuth {
  key: string;
  keyPrefix?: string;
}

export interface ApiKeyAuthEncrypted {
  keyEncrypted: string;
  keyPrefix?: string;
}

export interface BasicAuth {
  username: string;
  password: string;
}

export interface BasicAuthEncrypted {
  username: string;
  passwordEncrypted: string;
}

export interface OAuth2Auth {
  accessToken: string;
  refreshToken?: string;
  tokenExpiry?: number;
  scopes?: string[];
}

export interface OAuth2AuthEncrypted {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiry?: number;
  scopes?: string[];
}

export interface ConnectionConfig {
  domain?: string;
  apiVersion?: string;
  apiEndpoint?: string;
  timeout?: number;
  rateLimit?: number;
}

export interface Capabilities {
  canSync?: boolean;
  canPush?: boolean;
  canWebhook?: boolean;
  syncFrequency?: string;
}

export interface ConnectorOperation {
  name: string;
  title?: string;
  description?: string;
  parametersSchema?: unknown;
}

export interface ConnectorConfig {
  code: string;
  version: number;
  operations: ConnectorOperation[];
  secretBindings: string[];
  allowedHosts?: string[];
  timeoutMs?: number;
}

export interface SqlConnectionConfig {
  engine: SqlEngine;
  server: string;
  port?: number;
  database: string;
  readOnly?: boolean;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    connectionTimeout?: number;
    requestTimeout?: number;
  };
  security?: {
    maxResultRows?: number;
    queryTimeoutMs?: number;
    maxConnectionPoolSize?: number;
  };
}

export interface SqlOperation {
  name: string;
  title?: string;
  description?: string;
  query: string;
  parametersSchema?: unknown;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

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
