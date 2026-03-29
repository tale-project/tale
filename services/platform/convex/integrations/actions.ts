'use node';

/**
 * Public integration actions.
 *
 * These actions provide the authenticated API surface for integration management.
 * File-based operations (list, install, save config) are in file_actions.ts.
 * Credential CRUD is in credential_mutations.ts / credential_queries.ts.
 * This file provides higher-level actions that combine file + credential operations.
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { encryptCredentials } from './encrypt_credentials';
import { generateOAuth2AuthUrl } from './generate_oauth2_auth_url';
import { saveOAuth2ClientCredentials as saveOAuth2ClientCredentialsHandler } from './save_oauth2_client_credentials';
import { testConnection as testConnectionHandler } from './test_connection';
import {
  apiKeyAuthValidator,
  authMethodValidator,
  basicAuthValidator,
  capabilitiesValidator,
  connectionConfigValidator,
  oauth2AuthValidator,
  sqlConnectionConfigValidator,
  statusValidator,
  testConnectionResultValidator,
} from './validators';

/**
 * Save credentials for an integration (encrypts plaintext before storing).
 * Frontend sends plaintext credentials; this action encrypts them and writes to DB.
 */
export const saveCredentials = action({
  args: {
    credentialId: v.id('integrationCredentials'),
    status: v.optional(statusValidator),
    isActive: v.optional(v.boolean()),
    authMethod: v.optional(authMethodValidator),
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    iconStorageId: v.optional(v.id('_storage')),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const cred = await ctx.runQuery(
      internal.integrations.credential_queries.verifyCredentialAccess,
      { credentialId: args.credentialId, userId: String(authUser._id) },
    );
    if (!cred) throw new Error('Credential not found or access denied');

    const { credentialId, apiKeyAuth, basicAuth, oauth2Auth, ...rest } = args;

    // Encrypt plaintext credentials
    const encrypted = await encryptCredentials({
      apiKeyAuth,
      basicAuth,
      oauth2Auth,
    });

    const patch: Record<string, unknown> = { ...rest };
    if (encrypted.apiKeyAuth) patch.apiKeyAuth = encrypted.apiKeyAuth;
    if (encrypted.basicAuth) patch.basicAuth = encrypted.basicAuth;
    if (encrypted.oauth2Auth) patch.oauth2Auth = encrypted.oauth2Auth;

    await ctx.runMutation(
      internal.integrations.credential_mutations.updateCredentialsInternal,
      { credentialId, ...patch },
    );

    return null;
  },
});

export const testConnection = action({
  args: {
    credentialId: v.id('integrationCredentials'),
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
  },
  returns: testConnectionResultValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const cred = await ctx.runQuery(
      internal.integrations.credential_queries.verifyCredentialAccess,
      { credentialId: args.credentialId, userId: String(authUser._id) },
    );
    if (!cred) throw new Error('Credential not found or access denied');

    return await testConnectionHandler(ctx, args);
  },
});

export const generateOAuth2Url = action({
  args: {
    credentialId: v.id('integrationCredentials'),
    organizationId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const cred = await ctx.runQuery(
      internal.integrations.credential_queries.verifyCredentialAccess,
      { credentialId: args.credentialId, userId: String(authUser._id) },
    );
    if (!cred) throw new Error('Credential not found or access denied');

    return await generateOAuth2AuthUrl(ctx, args);
  },
});

export const saveOAuth2ClientCredentials = action({
  args: {
    credentialId: v.id('integrationCredentials'),
    authorizationUrl: v.string(),
    tokenUrl: v.string(),
    scopes: v.optional(v.array(v.string())),
    clientId: v.string(),
    clientSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const cred = await ctx.runQuery(
      internal.integrations.credential_queries.verifyCredentialAccess,
      { credentialId: args.credentialId, userId: String(authUser._id) },
    );
    if (!cred) throw new Error('Credential not found or access denied');

    await saveOAuth2ClientCredentialsHandler(ctx, args);
    return null;
  },
});
