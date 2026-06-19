import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation, mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { jsonRecordValidator } from '../lib/validators/json';
import { deleteSlackInstallationsForCredential } from './slack_installations';
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

    const id = await ctx.db.insert('integrationCredentials', args);
    // A credential created already-active connects the integration: install its
    // bundled agents + workflows.
    if (args.status === 'active' && args.isActive) {
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.bundle_provision.provisionIntegrationBundle,
        { organizationId: args.organizationId, slug: args.slug },
      );
    }
    return id;
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const cred = await ctx.db.get(args.credentialId);
    if (!cred) throw new Error('Credential record not found');

    const member = await getOrganizationMember(
      ctx,
      cred.organizationId,
      authUser,
    );

    const { credentialId, ...updates } = args;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    );
    await ctx.db.patch(credentialId, cleanUpdates);

    // Cascade on connect/disconnect transitions: connecting installs the
    // integration's bundled agents/workflows; disconnecting disables them (and
    // any agents that hard-require this integration).
    const wasActive = cred.isActive && cred.status === 'active';
    const nowActive =
      (updates.isActive ?? cred.isActive) &&
      (updates.status ?? cred.status) === 'active';
    if (nowActive && !wasActive) {
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.bundle_provision.provisionIntegrationBundle,
        { organizationId: cred.organizationId, slug: cred.slug },
      );
    } else if (!nowActive && wasActive) {
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.cascade.cascadeIntegration,
        {
          organizationId: cred.organizationId,
          slug: cred.slug,
          mode: 'disable',
        },
      );
    }

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: cred.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: member?.role,
          type: 'user',
        },
      },
      action: 'update_credential',
      category: 'integration',
      resourceType: 'integrationCredentials',
      resourceId: String(credentialId),
      resourceName: cred.slug,
      previousState: AuditLogHelpers.redactSensitiveFields({
        status: cred.status,
        authMethod: cred.authMethod,
        isActive: cred.isActive,
      }),
      newState: AuditLogHelpers.redactSensitiveFields({
        ...cleanUpdates,
      }),
    });

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const cred = await ctx.db.get(args.credentialId);
    if (!cred) throw new Error('Credential record not found');

    const member = await getOrganizationMember(
      ctx,
      cred.organizationId,
      authUser,
    );

    if (cred.iconStorageId) {
      await ctx.storage.delete(cred.iconStorageId);
    }

    if (cred.slug === 'slack') {
      await deleteSlackInstallationsForCredential(ctx, args.credentialId);
    }

    await ctx.db.delete(args.credentialId);

    // Disconnecting the integration: cascade-disable its bundled + requiring
    // agents and deactivate its bundled workflows' triggers.
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.cascade.cascadeIntegration,
      { organizationId: cred.organizationId, slug: cred.slug, mode: 'disable' },
    );

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: cred.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: member?.role,
          type: 'user',
        },
      },
      action: 'delete_credential',
      category: 'integration',
      resourceType: 'integrationCredentials',
      resourceId: String(args.credentialId),
      resourceName: cred.slug,
      previousState: AuditLogHelpers.redactSensitiveFields({
        slug: cred.slug,
        status: cred.status,
        authMethod: cred.authMethod,
      }),
    });

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

    if (cred.slug === 'slack') {
      await deleteSlackInstallationsForCredential(ctx, args.credentialId);
    }

    await ctx.db.delete(args.credentialId);
  },
});
