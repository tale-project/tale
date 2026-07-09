import { v } from 'convex/values';

import { internal } from '../_generated/api';
import {
  type MutationCtx,
  internalMutation,
  mutation,
} from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
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
  smtpAuthEncryptedValidator,
  sqlConnectionConfigValidator,
} from './validators';

/**
 * Connecting an integration installs its bundled agents + workflows. Scheduled
 * (not awaited) because the provisioner is a `'use node'` action a V8 mutation
 * cannot call directly.
 */
function scheduleBundleProvision(
  ctx: MutationCtx,
  organizationId: string,
  slug: string,
): Promise<unknown> {
  return ctx.scheduler.runAfter(
    0,
    internal.integrations.bundle_provision.provisionIntegrationBundle,
    { organizationId, slug },
  );
}

/**
 * Disconnecting an integration cascade-disables its bundled + hard-requiring
 * agents and deactivates its bundled workflows' triggers.
 */
function scheduleCascadeDisable(
  ctx: MutationCtx,
  organizationId: string,
  slug: string,
): Promise<unknown> {
  return ctx.scheduler.runAfter(
    0,
    internal.integrations.cascade.cascadeIntegration,
    { organizationId, slug, mode: 'disable' },
  );
}

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
    smtpAuth: v.optional(smtpAuthEncryptedValidator),
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
      await scheduleBundleProvision(ctx, args.organizationId, args.slug);
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
  smtpAuth: v.optional(smtpAuthEncryptedValidator),
  // Drop stored separate-SMTP credentials so sending reverts to the mailbox
  // login. Needed because a blank smtpAuth means "leave unchanged" — this is
  // the only way the credentials form can turn a separate provider back off.
  clearSmtpAuth: v.optional(v.boolean()),
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

    // Connecting/disconnecting an integration installs or cascade-disables its
    // bundled agents/workflows and writes its stored credentials — the same
    // capability-bearing surface the providers/skills paths gate on. A plain
    // `member` is hidden from the integrations UI by
    // `cannot('read','developerSettings')` but could previously call this
    // mutation directly via the Convex client; require the capability here too.
    const { member } = await requireOrgAdminOrDeveloper(
      ctx,
      cred.organizationId,
    );

    const { credentialId, clearSmtpAuth, ...updates } = args;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    );
    // Patching a field to `undefined` removes it (see tasks/mutations.ts) —
    // revert sending to the mailbox login when the separate provider is off.
    if (clearSmtpAuth) cleanUpdates.smtpAuth = undefined;
    await ctx.db.patch(credentialId, cleanUpdates);

    // Cascade on connect/disconnect transitions: connecting installs the
    // integration's bundled agents/workflows; disconnecting disables them (and
    // any agents that hard-require this integration).
    const wasActive = cred.isActive && cred.status === 'active';
    const nowActive =
      (updates.isActive ?? cred.isActive) &&
      (updates.status ?? cred.status) === 'active';
    if (nowActive && !wasActive) {
      await scheduleBundleProvision(ctx, cred.organizationId, cred.slug);
    } else if (!nowActive && wasActive) {
      await scheduleCascadeDisable(ctx, cred.organizationId, cred.slug);
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
    const { credentialId, clearSmtpAuth, ...updates } = args;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    );
    // Patching a field to `undefined` removes it — revert sending to the
    // mailbox login when the separate SMTP provider is turned off.
    if (clearSmtpAuth) cleanUpdates.smtpAuth = undefined;
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

    // Deleting a credential disconnects the integration and cascade-disables
    // its bundled + hard-requiring agents — strictly destructive. Gate on the
    // `developerSettings` capability, matching the providers/skills pattern,
    // rather than admitting any non-disabled member.
    const { member } = await requireOrgAdminOrDeveloper(
      ctx,
      cred.organizationId,
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
    await scheduleCascadeDisable(ctx, cred.organizationId, cred.slug);

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
