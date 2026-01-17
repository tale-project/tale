/**
 * Convex validators for integration operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so those validators are defined using native Convex v.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  integrationTypeSchema,
  integrationAuthMethodSchema,
  integrationStatusSchema,
  operationTypeSchema,
  sqlEngineSchema,
  apiKeyAuthSchema,
  apiKeyAuthEncryptedSchema,
  basicAuthSchema,
  basicAuthEncryptedSchema,
  oauth2AuthSchema,
  oauth2AuthEncryptedSchema,
  connectionConfigSchema,
  capabilitiesSchema,
  testConnectionResultSchema,
} from '../../lib/shared/schemas/integrations';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  integrationTypeSchema,
  integrationAuthMethodSchema,
  integrationStatusSchema,
  operationTypeSchema,
  sqlEngineSchema,
  apiKeyAuthSchema,
  apiKeyAuthEncryptedSchema,
  basicAuthSchema,
  basicAuthEncryptedSchema,
  oauth2AuthSchema,
  oauth2AuthEncryptedSchema,
  connectionConfigSchema,
  capabilitiesSchema,
  testConnectionResultSchema,
} from '../../lib/shared/schemas/integrations';

// Simple schemas that work with zodToConvex
export const integrationTypeValidator = zodToConvex(integrationTypeSchema);
export const authMethodValidator = zodToConvex(integrationAuthMethodSchema);
export const statusValidator = zodToConvex(integrationStatusSchema);
export const operationTypeValidator = zodToConvex(operationTypeSchema);
export const sqlEngineValidator = zodToConvex(sqlEngineSchema);
export const apiKeyAuthValidator = zodToConvex(apiKeyAuthSchema);
export const apiKeyAuthEncryptedValidator = zodToConvex(apiKeyAuthEncryptedSchema);
export const basicAuthValidator = zodToConvex(basicAuthSchema);
export const basicAuthEncryptedValidator = zodToConvex(basicAuthEncryptedSchema);
export const oauth2AuthValidator = zodToConvex(oauth2AuthSchema);
export const oauth2AuthEncryptedValidator = zodToConvex(oauth2AuthEncryptedSchema);
export const connectionConfigValidator = zodToConvex(connectionConfigSchema);
export const capabilitiesValidator = zodToConvex(capabilitiesSchema);
export const testConnectionResultValidator = zodToConvex(testConnectionResultSchema);

// Complex schemas that use jsonRecordSchema (contains z.lazy) - defined with native Convex v
export const connectorOperationValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  parametersSchema: v.optional(jsonRecordValidator),
  operationType: v.optional(operationTypeValidator),
  requiresApproval: v.optional(v.boolean()),
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
  server: v.string(),
  port: v.optional(v.number()),
  database: v.string(),
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
});

const syncStatsValidator = v.object({
  totalRecords: v.optional(v.number()),
  lastSyncCount: v.optional(v.number()),
  failedSyncCount: v.optional(v.number()),
});

export const integrationDocValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  type: v.optional(integrationTypeValidator),
  status: statusValidator,
  isActive: v.boolean(),
  authMethod: authMethodValidator,
  apiKeyAuth: v.optional(apiKeyAuthEncryptedValidator),
  basicAuth: v.optional(basicAuthEncryptedValidator),
  oauth2Auth: v.optional(oauth2AuthEncryptedValidator),
  connectionConfig: v.optional(connectionConfigValidator),
  lastSyncedAt: v.optional(v.number()),
  lastTestedAt: v.optional(v.number()),
  lastSuccessAt: v.optional(v.number()),
  lastErrorAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  syncStats: v.optional(syncStatsValidator),
  capabilities: v.optional(capabilitiesValidator),
  connector: v.optional(connectorConfigValidator),
  sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
  sqlOperations: v.optional(v.array(sqlOperationValidator)),
  metadata: v.optional(jsonRecordValidator),
});
