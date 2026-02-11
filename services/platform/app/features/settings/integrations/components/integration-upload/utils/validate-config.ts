import { z } from 'zod';

const operationSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  operationType: z.enum(['read', 'write']).optional(),
  requiresApproval: z.boolean().optional(),
  query: z.string().optional(),
  parametersSchema: z.record(z.string(), z.any()).optional(),
});

const connectionConfigSchema = z
  .object({
    domain: z.string().optional(),
    apiVersion: z.string().optional(),
    apiEndpoint: z.string().optional(),
    timeout: z.number().optional(),
    rateLimit: z.number().optional(),
  })
  .optional();

const sqlConnectionConfigSchema = z
  .object({
    engine: z.enum(['mssql', 'postgres', 'mysql']),
    server: z.string().min(1).optional(),
    port: z.number().optional(),
    database: z.string().min(1).optional(),
    readOnly: z.boolean().optional(),
    options: z
      .object({
        encrypt: z.boolean().optional(),
        trustServerCertificate: z.boolean().optional(),
        connectionTimeout: z.number().optional(),
        requestTimeout: z.number().optional(),
      })
      .optional(),
    security: z
      .object({
        maxResultRows: z.number().optional(),
        queryTimeoutMs: z.number().optional(),
        maxConnectionPoolSize: z.number().optional(),
      })
      .optional(),
  })
  .optional();

const oauth2ConfigSchema = z
  .object({
    authorizationUrl: z.string().url(),
    tokenUrl: z.string().url(),
    scopes: z.array(z.string()).optional(),
  })
  .optional();

const authMethodEnum = z.enum([
  'api_key',
  'bearer_token',
  'basic_auth',
  'oauth2',
]);

export const integrationConfigSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(
        /^[a-z][a-z0-9_-]*$/,
        'Name must be lowercase alphanumeric with dashes/underscores',
      ),
    title: z.string().min(1).max(128),
    description: z.string().max(512).optional(),
    version: z.number().int().positive().optional(),
    type: z.enum(['rest_api', 'sql']).optional(),
    authMethod: authMethodEnum,
    supportedAuthMethods: z.array(authMethodEnum).min(1).optional(),
    secretBindings: z.array(z.string().min(1)).min(1),
    allowedHosts: z.array(z.string()).optional(),
    operations: z.array(operationSchema).min(1),
    connectionConfig: connectionConfigSchema,
    sqlConnectionConfig: sqlConnectionConfigSchema,
    oauth2Config: oauth2ConfigSchema,
  })
  .refine(
    (data) =>
      !data.supportedAuthMethods ||
      data.supportedAuthMethods.includes(data.authMethod),
    {
      message: 'authMethod must be included in supportedAuthMethods',
      path: ['authMethod'],
    },
  );

export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

export interface ValidationResult {
  success: boolean;
  config?: IntegrationConfig;
  errors?: string[];
}

export function validateConfig(raw: unknown): ValidationResult {
  const result = integrationConfigSchema.safeParse(raw);

  if (result.success) {
    return { success: true, config: result.data };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`,
  );
  return { success: false, errors };
}
