/**
 * Internal mutation to create an integration
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { createIntegrationInternal as createIntegrationInternalHelper } from '../create_integration_internal';
import { jsonValueValidator, jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { connectorConfigValidator, sqlConnectionConfigValidator, sqlOperationValidator } from '../validators';

const statusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
  v.literal('testing'),
);

const authMethodValidator = v.union(
  v.literal('api_key'),
  v.literal('bearer_token'),
  v.literal('basic_auth'),
  v.literal('oauth2'),
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
      username: v.string(),
      passwordEncrypted: v.string(),
    })),
    oauth2Auth: v.optional(v.object({
      accessTokenEncrypted: v.string(),
      refreshTokenEncrypted: v.optional(v.string()),
      tokenExpiry: v.optional(v.number()),
      scopes: v.optional(v.array(v.string())),
    })),
    connectionConfig: v.optional(jsonRecordValidator),
    capabilities: v.optional(v.object({
      canSync: v.optional(v.boolean()),
      canPush: v.optional(v.boolean()),
      canWebhook: v.optional(v.boolean()),
      syncFrequency: v.optional(v.string()),
    })),
    connector: v.optional(connectorConfigValidator),
    type: v.optional(typeValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    sqlOperations: v.optional(v.array(sqlOperationValidator)),
    metadata: v.optional(jsonValueValidator),
  },
  handler: async (ctx, args) => {
    return await createIntegrationInternalHelper(ctx, args);
  },
});
