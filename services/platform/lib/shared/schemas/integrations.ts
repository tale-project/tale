import { z } from 'zod/v4';

/**
 * Schema for the integration config.json file format.
 *
 * This is the canonical schema for integration configuration files stored on disk.
 * The integration slug (identifier) is derived from the directory name, NOT from a
 * field in the config. Credentials and runtime state live in the DB
 * (integrationCredentials table), not in these files.
 */

const operationSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  operationType: z.enum(['read', 'write']).optional(),
  requiresApproval: z.boolean().optional(),
  requiredScopes: z.array(z.string()).optional(),
  parametersSchema: z.record(z.string(), z.unknown()).optional(),
});

const connectionConfigSchema = z.object({
  domain: z.string().optional(),
  apiVersion: z.string().optional(),
  apiEndpoint: z.string().optional(),
  timeout: z.number().optional(),
  rateLimit: z.number().optional(),
});

const capabilitiesSchema = z.object({
  canSync: z.boolean().optional(),
  canPush: z.boolean().optional(),
  canWebhook: z.boolean().optional(),
  syncFrequency: z.string().optional(),
});

const oauth2ConfigTemplateSchema = z.object({
  authorizationUrl: z.string(),
  tokenUrl: z.string(),
  scopes: z.array(z.string()).optional(),
});

const sqlConnectionOptionsSchema = z.object({
  encrypt: z.boolean().optional(),
  trustServerCertificate: z.boolean().optional(),
  connectionTimeout: z.number().optional(),
  requestTimeout: z.number().optional(),
});

const sqlSecuritySchema = z.object({
  maxResultRows: z.number().optional(),
  queryTimeoutMs: z.number().optional(),
  maxConnectionPoolSize: z.number().optional(),
});

const sqlConnectionConfigTemplateSchema = z.object({
  engine: z.enum(['mssql', 'postgres', 'mysql']),
  readOnly: z.boolean().optional(),
  options: sqlConnectionOptionsSchema.optional(),
  security: sqlSecuritySchema.optional(),
});

const sqlOperationSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  query: z.string(),
  parametersSchema: z.record(z.string(), z.unknown()).optional(),
  operationType: z.enum(['read', 'write']).optional(),
  requiresApproval: z.boolean().optional(),
});

export const integrationJsonSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  version: z.number().int().optional(),
  installed: z.boolean().default(false),
  type: z.enum(['rest_api', 'sql']).optional(),
  authMethod: z.enum(['api_key', 'bearer_token', 'basic_auth', 'oauth2']),
  supportedAuthMethods: z
    .array(z.enum(['api_key', 'bearer_token', 'basic_auth', 'oauth2']))
    .optional(),
  secretBindings: z.array(z.string()).optional(),
  allowedHosts: z.array(z.string()).optional(),
  operations: z.array(operationSchema).optional(),
  connectionConfig: connectionConfigSchema.optional(),
  capabilities: capabilitiesSchema.optional(),
  oauth2Config: oauth2ConfigTemplateSchema.optional(),
  sqlConnectionConfig: sqlConnectionConfigTemplateSchema.optional(),
  sqlOperations: z.array(sqlOperationSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IntegrationJsonConfig = z.infer<typeof integrationJsonSchema>;
