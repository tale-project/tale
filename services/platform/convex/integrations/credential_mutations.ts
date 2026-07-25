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
 * Disconnecting an integration cascade-disables agents that hard-require it;
 * reconnecting restores them and (re)provisions the schedules of the automations
 * bound to it. Scheduled (not awaited) because the cascade coordinator is a
 * `'use node'` action a V8 mutation cannot call directly.
 */
function scheduleCascade(
  ctx: MutationCtx,
  organizationId: string,
  slug: string,
  mode: 'disable' | 'enable',
): Promise<unknown> {
  return ctx.scheduler.runAfter(
    0,
    internal.integrations.cascade.cascadeIntegration,
    { organizationId, slug, mode },
  );
}

/**
 * Whether this patch flips the credential's connected state, and which way.
 * `null` when the transition is a no-op (a plain credential edit, a re-save of
 * an already-connected integration) — the cascade only runs on a real edge.
 */
function connectedTransition(
  cred: { isActive: boolean; status: string },
  updates: { isActive?: boolean; status?: string },
): 'disable' | 'enable' | null {
  const wasActive = cred.isActive && cred.status === 'active';
  const nowActive =
    (updates.isActive ?? cred.isActive) &&
    (updates.status ?? cred.status) === 'active';
  if (wasActive === nowActive) return null;
  return nowActive ? 'enable' : 'disable';
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

    // Disconnecting an integration cascade-disables agents that hard-require
    // it, and this mutation writes its stored credentials — the same
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

    // Cascade on either connected-state edge: disconnect disables the agents
    // that hard-require this integration, reconnect restores them and revives
    // the bound automations' schedules.
    const transition = connectedTransition(cred, updates);
    if (transition) {
      await scheduleCascade(ctx, cred.organizationId, cred.slug, transition);
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
    const cred = await ctx.db.get(credentialId);
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    );
    // Patching a field to `undefined` removes it — revert sending to the
    // mailbox login when the separate SMTP provider is turned off.
    if (clearSmtpAuth) cleanUpdates.smtpAuth = undefined;
    await ctx.db.patch(credentialId, cleanUpdates);

    // Same connected-state cascade the user-facing mutation runs: the OAuth2
    // token exchange completes a (re)connection here, and a failed refresh
    // parks the credential in `error`. Edge-gated, so a plain token refresh
    // (active → active) is a no-op.
    if (cred) {
      const transition = connectedTransition(cred, updates);
      if (transition) {
        await scheduleCascade(ctx, cred.organizationId, cred.slug, transition);
      }
    }
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
    // its hard-requiring agents — strictly destructive. Gate on the
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

    // Disconnecting the integration: cascade-disable its hard-requiring agents.
    await scheduleCascade(ctx, cred.organizationId, cred.slug, 'disable');

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
