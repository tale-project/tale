import { z } from 'zod/v4';

const transportTypeSchema = z.enum(['stdio', 'sse', 'streamable_http']);

const authTypeSchema = z.enum(['none', 'api_key', 'oauth2']);

const grantTypeSchema = z.enum(['client_credentials', 'authorization_code']);

const oauth2ConfigInputSchema = z.object({
  tokenUrl: z.url(),
  authorizationUrl: z.url().optional(),
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(2000),
  scopes: z.array(z.string().max(200)).optional(),
  grantType: grantTypeSchema,
});

type OAuth2ConfigInput = z.infer<typeof oauth2ConfigInputSchema>;

const namePattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const mcpServerBaseSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .regex(namePattern, 'Must be lowercase alphanumeric with hyphens'),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  transportType: transportTypeSchema,
  url: z.url().optional(),
  command: z.string().min(1).max(500).optional(),
  args: z.array(z.string().max(500)).optional(),
  env: z.record(z.string(), z.string()).optional(),
  authType: authTypeSchema,
  apiKey: z.string().min(1).max(5000).optional(),
  oauth2Config: oauth2ConfigInputSchema.optional(),
});

export const mcpServerCreateSchema = mcpServerBaseSchema.superRefine(
  (data, ctx) => {
    if (
      (data.transportType === 'sse' ||
        data.transportType === 'streamable_http') &&
      !data.url
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'URL is required for HTTP transports',
        path: ['url'],
      });
    }
    if (data.transportType === 'stdio' && !data.command) {
      ctx.addIssue({
        code: 'custom',
        message: 'Command is required for stdio transport',
        path: ['command'],
      });
    }
    if (data.authType === 'api_key' && !data.apiKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'API key is required when auth type is api_key',
        path: ['apiKey'],
      });
    }
    if (data.authType === 'oauth2' && !data.oauth2Config) {
      ctx.addIssue({
        code: 'custom',
        message: 'OAuth2 configuration is required when auth type is oauth2',
        path: ['oauth2Config'],
      });
    }
    if (
      data.oauth2Config?.grantType === 'authorization_code' &&
      !data.oauth2Config.authorizationUrl
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Authorization URL is required for authorization_code grant type',
        path: ['oauth2Config', 'authorizationUrl'],
      });
    }
  },
);

export type McpServerCreateInput = z.infer<typeof mcpServerCreateSchema>;

export const mcpServerUpdateSchema = mcpServerBaseSchema
  .partial()
  .required({ name: true })
  .superRefine((data, ctx) => {
    if (data.transportType) {
      if (
        (data.transportType === 'sse' ||
          data.transportType === 'streamable_http') &&
        !data.url
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'URL is required for HTTP transports',
          path: ['url'],
        });
      }
      if (data.transportType === 'stdio' && !data.command) {
        ctx.addIssue({
          code: 'custom',
          message: 'Command is required for stdio transport',
          path: ['command'],
        });
      }
    }
    if (data.authType === 'api_key' && !data.apiKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'API key is required when auth type is api_key',
        path: ['apiKey'],
      });
    }
    if (data.authType === 'oauth2' && !data.oauth2Config) {
      ctx.addIssue({
        code: 'custom',
        message: 'OAuth2 configuration is required when auth type is oauth2',
        path: ['oauth2Config'],
      });
    }
  });

export type McpServerUpdateInput = z.infer<typeof mcpServerUpdateSchema>;

export {
  transportTypeSchema,
  authTypeSchema,
  grantTypeSchema,
  oauth2ConfigInputSchema,
};

export type { OAuth2ConfigInput };
