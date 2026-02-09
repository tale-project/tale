import { v } from 'convex/values';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { createIntegrationInternal as createIntegrationHelper } from './create_integration_internal';
import {
  statusValidator,
  apiKeyAuthEncryptedValidator,
  basicAuthEncryptedValidator,
  oauth2AuthEncryptedValidator,
  connectionConfigValidator,
  capabilitiesValidator,
  connectorConfigValidator,
  sqlConnectionConfigValidator,
  sqlOperationValidator,
} from './validators';

const authMethodValidator = v.union(
  v.literal('api_key'),
  v.literal('bearer_token'),
  v.literal('basic_auth'),
  v.literal('oauth2'),
);

const typeValidator = v.union(v.literal('rest_api'), v.literal('sql'));

export const createIntegration = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: statusValidator,
    isActive: v.boolean(),
    authMethod: authMethodValidator,
    apiKeyAuth: v.optional(
      v.object({
        keyEncrypted: v.string(),
        headerName: v.optional(v.string()),
        prefix: v.optional(v.string()),
      }),
    ),
    basicAuth: v.optional(
      v.object({
        username: v.string(),
        passwordEncrypted: v.string(),
      }),
    ),
    oauth2Auth: v.optional(
      v.object({
        accessTokenEncrypted: v.string(),
        refreshTokenEncrypted: v.optional(v.string()),
        tokenExpiry: v.optional(v.number()),
        scopes: v.optional(v.array(v.string())),
      }),
    ),
    connectionConfig: v.optional(jsonRecordValidator),
    capabilities: v.optional(
      v.object({
        canSync: v.optional(v.boolean()),
        canPush: v.optional(v.boolean()),
        canWebhook: v.optional(v.boolean()),
        syncFrequency: v.optional(v.string()),
      }),
    ),
    connector: v.optional(connectorConfigValidator),
    type: v.optional(typeValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    sqlOperations: v.optional(v.array(sqlOperationValidator)),
    metadata: v.optional(jsonValueValidator),
  },
  handler: async (ctx, args) => {
    return await createIntegrationHelper(ctx, args);
  },
});

export const updateIntegration = internalMutation({
  args: {
    integrationId: v.id('integrations'),
    status: v.optional(statusValidator),
    isActive: v.optional(v.boolean()),
    apiKeyAuth: v.optional(apiKeyAuthEncryptedValidator),
    basicAuth: v.optional(basicAuthEncryptedValidator),
    oauth2Auth: v.optional(oauth2AuthEncryptedValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const { integrationId, ...updates } = args;

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    );

    await ctx.db.patch(integrationId, cleanUpdates);
  },
});
