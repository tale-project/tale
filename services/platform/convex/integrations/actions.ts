'use node';

import { v } from 'convex/values';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';
import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { createIntegration } from './create_integration';
import { generateOAuth2AuthUrl } from './generate_oauth2_auth_url';
import { saveOAuth2ClientCredentials as saveOAuth2ClientCredentialsHandler } from './save_oauth2_client_credentials';
import { testConnection as testConnectionHandler } from './test_connection';
import { updateIntegration } from './update_integration';
import {
  authMethodValidator,
  apiKeyAuthValidator,
  basicAuthValidator,
  oauth2AuthValidator,
  oauth2ConfigValidator,
  connectionConfigValidator,
  capabilitiesValidator,
  connectorConfigValidator,
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
    supportedAuthMethods: v.optional(v.array(authMethodValidator)),
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    connector: v.optional(connectorConfigValidator),
    type: v.optional(v.union(v.literal('rest_api'), v.literal('sql'))),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    sqlOperations: v.optional(v.array(sqlOperationValidator)),
    oauth2Config: v.optional(oauth2ConfigValidator),
    iconStorageId: v.optional(v.id('_storage')),
    metadata: v.optional(jsonValueValidator),
  },
  returns: v.id('integrations'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await createIntegration(ctx, args);
  },
});

export const update = action({
  args: {
    integrationId: v.id('integrations'),
    authMethod: v.optional(authMethodValidator),
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

    await updateIntegration(ctx, args);
    return null;
  },
});

export const testConnection = action({
  args: {
    integrationId: v.id('integrations'),
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
  },
  returns: testConnectionResultValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await testConnectionHandler(ctx, args);
  },
});

export const generateOAuth2Url = action({
  args: {
    integrationId: v.id('integrations'),
    organizationId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await generateOAuth2AuthUrl(ctx, args);
  },
});

export const saveOAuth2ClientCredentials = action({
  args: {
    integrationId: v.id('integrations'),
    authorizationUrl: v.string(),
    tokenUrl: v.string(),
    scopes: v.optional(v.array(v.string())),
    clientId: v.string(),
    clientSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await saveOAuth2ClientCredentialsHandler(ctx, args);
    return null;
  },
});

export const updateIcon = action({
  args: {
    integrationId: v.id('integrations'),
    iconStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(api.integrations.mutations.updateIcon, args);
  },
});

export const deleteIntegrationAction = action({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(
      api.integrations.mutations.deleteIntegration,
      args,
    );
  },
});
