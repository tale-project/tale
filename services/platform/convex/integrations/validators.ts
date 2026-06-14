/**
 * Convex validators for integration operations
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const integrationTypeValidator = v.union(
  v.literal('rest_api'),
  v.literal('sql'),
);

export const authMethodValidator = v.union(
  v.literal('api_key'),
  v.literal('bearer_token'),
  v.literal('basic_auth'),
  v.literal('oauth2'),
);

export const statusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
  v.literal('testing'),
);

export const operationTypeValidator = v.union(
  v.literal('read'),
  v.literal('write'),
);

export const sqlEngineValidator = v.union(
  v.literal('mssql'),
  v.literal('postgres'),
  v.literal('mysql'),
);

export const apiKeyAuthValidator = v.object({
  key: v.string(),
  keyPrefix: v.optional(v.string()),
});

export const apiKeyAuthEncryptedValidator = v.object({
  keyEncrypted: v.string(),
  keyPrefix: v.optional(v.string()),
});

export const basicAuthValidator = v.object({
  username: v.string(),
  password: v.string(),
});

export const basicAuthEncryptedValidator = v.object({
  username: v.string(),
  passwordEncrypted: v.string(),
});

export const oauth2AuthValidator = v.object({
  accessToken: v.string(),
  refreshToken: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
});

export const oauth2AuthEncryptedValidator = v.object({
  accessTokenEncrypted: v.string(),
  refreshTokenEncrypted: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
});

export const oauth2ConfigValidator = v.object({
  authorizationUrl: v.string(),
  tokenUrl: v.string(),
  scopes: v.optional(v.array(v.string())),
});

export const oauth2ConfigStoredValidator = v.object({
  authorizationUrl: v.string(),
  tokenUrl: v.string(),
  scopes: v.optional(v.array(v.string())),
  clientId: v.optional(v.string()),
  clientSecretEncrypted: v.optional(v.string()),
  // Slack-only: app signing secret (encrypted) for inbound Events API
  // verification. Undefined for every other OAuth2 integration.
  signingSecretEncrypted: v.optional(v.string()),
});

/**
 * Connection config is integration-specific — each integration may store
 * custom fields (e.g. model, region) alongside standard ones (domain, timeout).
 * Use a flexible record validator to avoid rejecting unknown fields.
 */
export const connectionConfigValidator = v.any();

export const capabilitiesValidator = v.object({
  canSync: v.optional(v.boolean()),
  canPush: v.optional(v.boolean()),
  canWebhook: v.optional(v.boolean()),
  syncFrequency: v.optional(v.string()),
});

export const testConnectionResultValidator = v.object({
  success: v.boolean(),
  message: v.string(),
});

export const connectorOperationValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  parametersSchema: v.optional(jsonRecordValidator),
  operationType: v.optional(operationTypeValidator),
  requiresApproval: v.optional(v.boolean()),
  requiredScopes: v.optional(v.array(v.string())),
});

export const connectorConfigValidator = v.object({
  code: v.string(),
  version: v.number(),
  operations: v.array(connectorOperationValidator),
  secretBindings: v.array(v.string()),
  allowedHosts: v.optional(v.array(v.string())),
  timeoutMs: v.optional(v.number()),
});

const sqlConnectionOptionsValidator = v.object({
  encrypt: v.optional(v.boolean()),
  trustServerCertificate: v.optional(v.boolean()),
  connectionTimeout: v.optional(v.number()),
  requestTimeout: v.optional(v.number()),
});

const sqlSecurityValidator = v.object({
  maxResultRows: v.optional(v.number()),
  queryTimeoutMs: v.optional(v.number()),
  maxConnectionPoolSize: v.optional(v.number()),
});

export const sqlConnectionConfigValidator = v.object({
  engine: sqlEngineValidator,
  server: v.optional(v.string()),
  port: v.optional(v.number()),
  database: v.optional(v.string()),
  readOnly: v.optional(v.boolean()),
  options: v.optional(sqlConnectionOptionsValidator),
  security: v.optional(sqlSecurityValidator),
});

export const sqlOperationValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  query: v.string(),
  parametersSchema: v.optional(jsonRecordValidator),
  operationType: v.optional(operationTypeValidator),
  requiresApproval: v.optional(v.boolean()),
  requiredScopes: v.optional(v.array(v.string())),
});
