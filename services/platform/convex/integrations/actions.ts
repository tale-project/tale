'use node';

import { v } from 'convex/values';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { createIntegrationLogic } from './create_integration_logic';
import { testConnectionLogic } from './test_connection_logic';
import { updateIntegrationLogic } from './update_integration_logic';
import {
  authMethodValidator,
  apiKeyAuthValidator,
  basicAuthValidator,
  oauth2AuthValidator,
  connectionConfigValidator,
  capabilitiesValidator,
  sqlConnectionConfigValidator,
  sqlOperationValidator,
  statusValidator,
  testConnectionResultValidator,
} from './validators';

export const create = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    authMethod: authMethodValidator,
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    type: v.optional(v.union(v.literal('rest_api'), v.literal('sql'))),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    sqlOperations: v.optional(v.array(sqlOperationValidator)),
    metadata: v.optional(jsonValueValidator),
  },
  returns: v.id('integrations'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await createIntegrationLogic(ctx, args);
  },
});

export const update = action({
  args: {
    integrationId: v.id('integrations'),
    status: v.optional(statusValidator),
    isActive: v.optional(v.boolean()),
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await updateIntegrationLogic(ctx, args);
    return null;
  },
});

export const testConnection = action({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: testConnectionResultValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await testConnectionLogic(ctx, args);
  },
});
