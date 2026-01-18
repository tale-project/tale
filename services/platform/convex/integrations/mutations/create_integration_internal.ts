/**
 * Internal mutation to create an integration
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { createIntegrationInternal as createIntegrationInternalHelper } from '../create_integration_internal';
import { jsonValueValidator, jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

const statusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
  v.literal('pending'),
);

const authMethodValidator = v.union(
  v.literal('api_key'),
  v.literal('basic_auth'),
  v.literal('oauth2'),
  v.literal('none'),
);

const typeValidator = v.union(
  v.literal('rest_api'),
  v.literal('sql'),
);

export const createIntegrationInternal = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: statusValidator,
    isActive: v.boolean(),
    authMethod: authMethodValidator,
    apiKeyAuth: v.optional(v.object({
      keyEncrypted: v.string(),
      headerName: v.optional(v.string()),
      prefix: v.optional(v.string()),
    })),
    basicAuth: v.optional(v.object({
      usernameEncrypted: v.string(),
      passwordEncrypted: v.string(),
    })),
    oauth2Auth: v.optional(v.object({
      accessTokenEncrypted: v.optional(v.string()),
      refreshTokenEncrypted: v.optional(v.string()),
      clientId: v.optional(v.string()),
      clientSecretEncrypted: v.optional(v.string()),
      tokenUrl: v.optional(v.string()),
      scopes: v.optional(v.array(v.string())),
      expiresAt: v.optional(v.number()),
    })),
    connectionConfig: v.optional(jsonRecordValidator),
    capabilities: v.optional(v.object({
      supportsRead: v.optional(v.boolean()),
      supportsWrite: v.optional(v.boolean()),
      supportsDelete: v.optional(v.boolean()),
      supportsBatch: v.optional(v.boolean()),
    })),
    connector: v.optional(jsonValueValidator),
    type: v.optional(typeValidator),
    sqlConnectionConfig: v.optional(jsonRecordValidator),
    sqlOperations: v.optional(v.array(jsonRecordValidator)),
    metadata: v.optional(jsonValueValidator),
  },
  handler: async (ctx, args) => {
    return await createIntegrationInternalHelper(ctx, args);
  },
});
