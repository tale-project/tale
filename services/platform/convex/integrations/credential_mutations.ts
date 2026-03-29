import { v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { jsonRecordValidator } from '../lib/validators/json';
import {
  authMethodValidator,
  statusValidator,
  apiKeyAuthEncryptedValidator,
  basicAuthEncryptedValidator,
  oauth2AuthEncryptedValidator,
  oauth2ConfigStoredValidator,
  connectionConfigValidator,
  capabilitiesValidator,
  sqlConnectionConfigValidator,
} from './validators';

export const createCredentials = internalMutation({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    status: statusValidator,
    isActive: v.boolean(),
    authMethod: authMethodValidator,
    supportedAuthMethods: v.optional(v.array(authMethodValidator)),
    apiKeyAuth: v.optional(apiKeyAuthEncryptedValidator),
    basicAuth: v.optional(basicAuthEncryptedValidator),
    oauth2Auth: v.optional(oauth2AuthEncryptedValidator),
    oauth2Config: v.optional(oauth2ConfigStoredValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    iconStorageId: v.optional(v.id('_storage')),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', args.slug),
      )
      .first();

    if (existing) {
      throw new Error(
        `Integration credentials already exist for slug "${args.slug}" in this organization`,
      );
    }

    return await ctx.db.insert('integrationCredentials', args);
  },
});

const updateCredentialsArgs = {
  credentialId: v.id('integrationCredentials'),
  status: v.optional(statusValidator),
  isActive: v.optional(v.boolean()),
  authMethod: v.optional(authMethodValidator),
  supportedAuthMethods: v.optional(v.array(authMethodValidator)),
  apiKeyAuth: v.optional(apiKeyAuthEncryptedValidator),
  basicAuth: v.optional(basicAuthEncryptedValidator),
  oauth2Auth: v.optional(oauth2AuthEncryptedValidator),
  oauth2Config: v.optional(oauth2ConfigStoredValidator),
  connectionConfig: v.optional(connectionConfigValidator),
  sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
  capabilities: v.optional(capabilitiesValidator),
  lastSyncedAt: v.optional(v.number()),
  lastTestedAt: v.optional(v.number()),
  lastSuccessAt: v.optional(v.number()),
  lastErrorAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  iconStorageId: v.optional(v.id('_storage')),
  metadata: v.optional(jsonRecordValidator),
};

export const updateCredentials = mutation({
  args: updateCredentialsArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const { credentialId, ...updates } = args;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    );
    await ctx.db.patch(credentialId, cleanUpdates);
    return null;
  },
});

export const updateCredentialsInternal = internalMutation({
  args: updateCredentialsArgs,
  handler: async (ctx, args) => {
    const { credentialId, ...updates } = args;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    );
    await ctx.db.patch(credentialId, cleanUpdates);
  },
});

export const deleteCredentials = mutation({
  args: {
    credentialId: v.id('integrationCredentials'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const cred = await ctx.db.get(args.credentialId);
    if (!cred) throw new Error('Credential record not found');

    if (cred.iconStorageId) {
      await ctx.storage.delete(cred.iconStorageId);
    }

    await ctx.db.delete(args.credentialId);
    return null;
  },
});

export const deleteCredentialsInternal = internalMutation({
  args: {
    credentialId: v.id('integrationCredentials'),
  },
  handler: async (ctx, args) => {
    const cred = await ctx.db.get(args.credentialId);
    if (!cred) return;

    if (cred.iconStorageId) {
      await ctx.storage.delete(cred.iconStorageId);
    }

    await ctx.db.delete(args.credentialId);
  },
});
