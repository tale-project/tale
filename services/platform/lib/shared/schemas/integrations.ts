import { z } from 'zod/v4';

import { jsonRecordSchema } from './utils/json-value';

const integrationTypeLiterals = ['rest_api', 'sql'] as const;
export const integrationTypeSchema = z.enum(integrationTypeLiterals);
type IntegrationType = z.infer<typeof integrationTypeSchema>;

const integrationAuthMethodLiterals = [
  'api_key',
  'bearer_token',
  'basic_auth',
  'oauth2',
] as const;
export const integrationAuthMethodSchema = z.enum(
  integrationAuthMethodLiterals,
);
type IntegrationAuthMethod = z.infer<typeof integrationAuthMethodSchema>;

const integrationStatusLiterals = [
  'active',
  'inactive',
  'error',
  'testing',
] as const;
export const integrationStatusSchema = z.enum(integrationStatusLiterals);
type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

const operationTypeLiterals = ['read', 'write'] as const;
export const operationTypeSchema = z.enum(operationTypeLiterals);
type OperationType = z.infer<typeof operationTypeSchema>;

const sqlEngineLiterals = ['mssql', 'postgres', 'mysql'] as const;
export const sqlEngineSchema = z.enum(sqlEngineLiterals);
type SqlEngine = z.infer<typeof sqlEngineSchema>;

export const apiKeyAuthSchema = z.object({
  key: z.string(),
  keyPrefix: z.string().optional(),
});
type ApiKeyAuth = z.infer<typeof apiKeyAuthSchema>;

export const apiKeyAuthEncryptedSchema = z.object({
  keyEncrypted: z.string(),
  keyPrefix: z.string().optional(),
});
type ApiKeyAuthEncrypted = z.infer<typeof apiKeyAuthEncryptedSchema>;

export const basicAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});
type BasicAuth = z.infer<typeof basicAuthSchema>;

export const basicAuthEncryptedSchema = z.object({
  username: z.string(),
  passwordEncrypted: z.string(),
});
type BasicAuthEncrypted = z.infer<typeof basicAuthEncryptedSchema>;

export const oauth2AuthSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  tokenExpiry: z.number().optional(),
  scopes: z.array(z.string()).optional(),
});
type OAuth2Auth = z.infer<typeof oauth2AuthSchema>;

export const oauth2AuthEncryptedSchema = z.object({
  accessTokenEncrypted: z.string(),
  refreshTokenEncrypted: z.string().optional(),
  tokenExpiry: z.number().optional(),
  scopes: z.array(z.string()).optional(),
});
type OAuth2AuthEncrypted = z.infer<typeof oauth2AuthEncryptedSchema>;

export const oauth2ConfigSchema = z.object({
  authorizationUrl: z.string(),
  tokenUrl: z.string(),
  scopes: z.array(z.string()).optional(),
});
type OAuth2Config = z.infer<typeof oauth2ConfigSchema>;

export const oauth2ConfigStoredSchema = z.object({
  authorizationUrl: z.string(),
  tokenUrl: z.string(),
  scopes: z.array(z.string()).optional(),
  clientId: z.string().optional(),
  clientSecretEncrypted: z.string().optional(),
});
type OAuth2ConfigStored = z.infer<typeof oauth2ConfigStoredSchema>;

export const connectionConfigSchema = z.object({
  domain: z.string().optional(),
  apiVersion: z.string().optional(),
  apiEndpoint: z.string().optional(),
  timeout: z.number().optional(),
  rateLimit: z.number().optional(),
});
type ConnectionConfig = z.infer<typeof connectionConfigSchema>;

export const capabilitiesSchema = z.object({
  canSync: z.boolean().optional(),
  canPush: z.boolean().optional(),
  canWebhook: z.boolean().optional(),
  syncFrequency: z.string().optional(),
});
type Capabilities = z.infer<typeof capabilitiesSchema>;

const connectorOperationSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  parametersSchema: jsonRecordSchema.optional(),
  operationType: operationTypeSchema.optional(),
  requiresApproval: z.boolean().optional(),
});
type ConnectorOperation = z.infer<typeof connectorOperationSchema>;

const connectorConfigSchema = z.object({
  code: z.string(),
  version: z.number(),
  operations: z.array(connectorOperationSchema),
  secretBindings: z.array(z.string()),
  allowedHosts: z.array(z.string()).optional(),
  timeoutMs: z.number().optional(),
});
type ConnectorConfig = z.infer<typeof connectorConfigSchema>;

const sqlConnectionOptionsSchema = z.object({
  encrypt: z.boolean().optional(),
  trustServerCertificate: z.boolean().optional(),
  connectionTimeout: z.number().optional(),
  requestTimeout: z.number().optional(),
});
type SqlConnectionOptions = z.infer<typeof sqlConnectionOptionsSchema>;

const sqlSecuritySchema = z.object({
  maxResultRows: z.number().optional(),
  queryTimeoutMs: z.number().optional(),
  maxConnectionPoolSize: z.number().optional(),
});
type SqlSecurity = z.infer<typeof sqlSecuritySchema>;

const sqlConnectionConfigSchema = z.object({
  engine: sqlEngineSchema,
  server: z.string().optional(),
  port: z.number().optional(),
  database: z.string().optional(),
  readOnly: z.boolean().optional(),
  options: sqlConnectionOptionsSchema.optional(),
  security: sqlSecuritySchema.optional(),
});
type SqlConnectionConfig = z.infer<typeof sqlConnectionConfigSchema>;

const sqlOperationSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  query: z.string(),
  parametersSchema: jsonRecordSchema.optional(),
  operationType: operationTypeSchema.optional(),
  requiresApproval: z.boolean().optional(),
});
type SqlOperation = z.infer<typeof sqlOperationSchema>;

export const testConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

const syncStatsSchema = z.object({
  totalRecords: z.number().optional(),
  lastSyncCount: z.number().optional(),
  failedSyncCount: z.number().optional(),
});
type SyncStats = z.infer<typeof syncStatsSchema>;

const integrationDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  type: integrationTypeSchema.optional(),
  status: integrationStatusSchema,
  isActive: z.boolean(),
  authMethod: integrationAuthMethodSchema,
  supportedAuthMethods: z.array(integrationAuthMethodSchema).optional(),
  apiKeyAuth: apiKeyAuthEncryptedSchema.optional(),
  basicAuth: basicAuthEncryptedSchema.optional(),
  oauth2Auth: oauth2AuthEncryptedSchema.optional(),
  oauth2Config: oauth2ConfigStoredSchema.optional(),
  connectionConfig: connectionConfigSchema.optional(),
  lastSyncedAt: z.number().optional(),
  lastTestedAt: z.number().optional(),
  lastSuccessAt: z.number().optional(),
  lastErrorAt: z.number().optional(),
  errorMessage: z.string().optional(),
  syncStats: syncStatsSchema.optional(),
  capabilities: capabilitiesSchema.optional(),
  connector: connectorConfigSchema.optional(),
  sqlConnectionConfig: sqlConnectionConfigSchema.optional(),
  sqlOperations: z.array(sqlOperationSchema).optional(),
  metadata: jsonRecordSchema.optional(),
});
type IntegrationDoc = z.infer<typeof integrationDocSchema>;
