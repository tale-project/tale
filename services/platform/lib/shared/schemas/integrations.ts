import { z } from 'zod';
import { jsonRecordSchema } from './utils/json-value';

export const integrationTypeLiterals = ['rest_api', 'sql'] as const;
export const integrationTypeSchema = z.enum(integrationTypeLiterals);
export type IntegrationType = z.infer<typeof integrationTypeSchema>;

export const integrationAuthMethodLiterals = ['api_key', 'bearer_token', 'basic_auth', 'oauth2'] as const;
export const integrationAuthMethodSchema = z.enum(integrationAuthMethodLiterals);
export type IntegrationAuthMethod = z.infer<typeof integrationAuthMethodSchema>;

export const integrationStatusLiterals = ['active', 'inactive', 'error', 'testing'] as const;
export const integrationStatusSchema = z.enum(integrationStatusLiterals);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const operationTypeLiterals = ['read', 'write'] as const;
export const operationTypeSchema = z.enum(operationTypeLiterals);
export type OperationType = z.infer<typeof operationTypeSchema>;

export const sqlEngineLiterals = ['mssql', 'postgres', 'mysql'] as const;
export const sqlEngineSchema = z.enum(sqlEngineLiterals);
export type SqlEngine = z.infer<typeof sqlEngineSchema>;

export const apiKeyAuthSchema = z.object({
	key: z.string(),
	keyPrefix: z.string().optional(),
});
export type ApiKeyAuth = z.infer<typeof apiKeyAuthSchema>;

export const apiKeyAuthEncryptedSchema = z.object({
	keyEncrypted: z.string(),
	keyPrefix: z.string().optional(),
});
export type ApiKeyAuthEncrypted = z.infer<typeof apiKeyAuthEncryptedSchema>;

export const basicAuthSchema = z.object({
	username: z.string(),
	password: z.string(),
});
export type BasicAuth = z.infer<typeof basicAuthSchema>;

export const basicAuthEncryptedSchema = z.object({
	username: z.string(),
	passwordEncrypted: z.string(),
});
export type BasicAuthEncrypted = z.infer<typeof basicAuthEncryptedSchema>;

export const oauth2AuthSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string().optional(),
	tokenExpiry: z.number().optional(),
	scopes: z.array(z.string()).optional(),
});
export type OAuth2Auth = z.infer<typeof oauth2AuthSchema>;

export const oauth2AuthEncryptedSchema = z.object({
	accessTokenEncrypted: z.string(),
	refreshTokenEncrypted: z.string().optional(),
	tokenExpiry: z.number().optional(),
	scopes: z.array(z.string()).optional(),
});
export type OAuth2AuthEncrypted = z.infer<typeof oauth2AuthEncryptedSchema>;

export const connectionConfigSchema = z.object({
	domain: z.string().optional(),
	apiVersion: z.string().optional(),
	apiEndpoint: z.string().optional(),
	timeout: z.number().optional(),
	rateLimit: z.number().optional(),
});
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;

export const capabilitiesSchema = z.object({
	canSync: z.boolean().optional(),
	canPush: z.boolean().optional(),
	canWebhook: z.boolean().optional(),
	syncFrequency: z.string().optional(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export const connectorOperationSchema = z.object({
	name: z.string(),
	title: z.string().optional(),
	description: z.string().optional(),
	parametersSchema: jsonRecordSchema.optional(),
	operationType: operationTypeSchema.optional(),
	requiresApproval: z.boolean().optional(),
});
export type ConnectorOperation = z.infer<typeof connectorOperationSchema>;

export const connectorConfigSchema = z.object({
	code: z.string(),
	version: z.number(),
	operations: z.array(connectorOperationSchema),
	secretBindings: z.array(z.string()),
	allowedHosts: z.array(z.string()).optional(),
	timeoutMs: z.number().optional(),
});
export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;

export const sqlConnectionOptionsSchema = z.object({
	encrypt: z.boolean().optional(),
	trustServerCertificate: z.boolean().optional(),
	connectionTimeout: z.number().optional(),
	requestTimeout: z.number().optional(),
});
export type SqlConnectionOptions = z.infer<typeof sqlConnectionOptionsSchema>;

export const sqlSecuritySchema = z.object({
	maxResultRows: z.number().optional(),
	queryTimeoutMs: z.number().optional(),
	maxConnectionPoolSize: z.number().optional(),
});
export type SqlSecurity = z.infer<typeof sqlSecuritySchema>;

export const sqlConnectionConfigSchema = z.object({
	engine: sqlEngineSchema,
	server: z.string(),
	port: z.number().optional(),
	database: z.string(),
	readOnly: z.boolean().optional(),
	options: sqlConnectionOptionsSchema.optional(),
	security: sqlSecuritySchema.optional(),
});
export type SqlConnectionConfig = z.infer<typeof sqlConnectionConfigSchema>;

export const sqlOperationSchema = z.object({
	name: z.string(),
	title: z.string().optional(),
	description: z.string().optional(),
	query: z.string(),
	parametersSchema: jsonRecordSchema.optional(),
	operationType: operationTypeSchema.optional(),
	requiresApproval: z.boolean().optional(),
});
export type SqlOperation = z.infer<typeof sqlOperationSchema>;

export const testConnectionResultSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});
export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

export const syncStatsSchema = z.object({
	totalRecords: z.number().optional(),
	lastSyncCount: z.number().optional(),
	failedSyncCount: z.number().optional(),
});
export type SyncStats = z.infer<typeof syncStatsSchema>;

export const integrationDocSchema = z.object({
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
	apiKeyAuth: apiKeyAuthEncryptedSchema.optional(),
	basicAuth: basicAuthEncryptedSchema.optional(),
	oauth2Auth: oauth2AuthEncryptedSchema.optional(),
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
export type IntegrationDoc = z.infer<typeof integrationDocSchema>;
