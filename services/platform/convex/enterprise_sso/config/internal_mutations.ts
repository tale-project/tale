import { v } from 'convex/values';

import { internalMutation, type MutationCtx } from '../../_generated/server';
import * as AuditLogHelpers from '../../audit_logs/helpers';
import {
  attributeMappingValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  ssoProviderIdValidator,
} from '../validators';

/**
 * Storage writes for the unified SSO connection. Called by `config/actions.ts`
 * after it authenticates the admin and encrypts secrets. Each write preserves
 * the SCIM fields on the row (SCIM is managed separately).
 */

const provisioningArgs = {
  autoProvisionRole: v.boolean(),
  defaultRole: platformRoleValidator,
  roleMappingRules: v.array(roleMappingRuleValidator),
  autoProvisionTeam: v.boolean(),
  excludeGroups: v.array(v.string()),
};

const auditActor = (userId: string, email?: string, role?: string) => ({
  id: userId,
  email,
  role,
  type: 'user' as const,
});

async function getRow(ctx: MutationCtx, organizationId: string) {
  return ctx.db
    .query('ssoConnections')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
    .first();
}

function freshScimDefaults() {
  return { scimEnabled: false, scimTokenHash: '', scimTokenPrefix: '' };
}

export const writeOidc = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
    displayName: v.string(),
    domain: v.optional(v.string()),
    providerId: ssoProviderIdValidator,
    issuer: v.string(),
    authorizationEndpoint: v.optional(v.string()),
    tokenEndpoint: v.optional(v.string()),
    userinfoEndpoint: v.optional(v.string()),
    clientIdEncrypted: v.string(),
    clientSecretEncrypted: v.string(),
    scopes: v.array(v.string()),
    pkce: v.optional(v.boolean()),
    claimMappings: v.optional(attributeMappingValidator),
    domainHint: v.optional(v.string()),
    enableOneDriveAccess: v.optional(v.boolean()),
    ...provisioningArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const protocol = args.providerId === 'oauth2' ? 'oauth2' : 'oidc';
    const oidcConfig = {
      providerId: args.providerId,
      issuer: args.issuer,
      authorizationEndpoint: args.authorizationEndpoint,
      tokenEndpoint: args.tokenEndpoint,
      userinfoEndpoint: args.userinfoEndpoint,
      clientIdEncrypted: args.clientIdEncrypted,
      clientSecretEncrypted: args.clientSecretEncrypted,
      scopes: args.scopes,
      pkce: args.pkce,
      claimMappings: args.claimMappings,
      domainHint: args.domainHint,
      enableOneDriveAccess: args.enableOneDriveAccess,
    };
    const provisioning = {
      autoProvisionRole: args.autoProvisionRole,
      defaultRole: args.defaultRole,
      roleMappingRules: args.roleMappingRules,
      autoProvisionTeam: args.autoProvisionTeam,
      excludeGroups: args.excludeGroups,
    };
    const row = await getRow(ctx, args.organizationId);
    if (row) {
      await ctx.db.patch(row._id, {
        protocol,
        displayName: args.displayName,
        domain: args.domain,
        enabled: true,
        oidcConfig,
        samlConfig: undefined,
        ...provisioning,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('ssoConnections', {
        organizationId: args.organizationId,
        protocol,
        displayName: args.displayName,
        domain: args.domain,
        enabled: true,
        oidcConfig,
        ...provisioning,
        ...freshScimDefaults(),
        createdBy: args.actorId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: auditActor(args.actorId, args.actorEmail, args.actorRole),
      },
      action: 'sso_configure',
      category: 'security',
      resourceType: 'sso',
      resourceId: args.organizationId,
      newState: { protocol, providerId: args.providerId },
    });
    return null;
  },
});

export const writeSaml = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
    displayName: v.string(),
    domain: v.optional(v.string()),
    idpEntityId: v.string(),
    idpSsoUrl: v.string(),
    idpCertificate: v.string(),
    spPrivateKeyEncrypted: v.optional(v.string()),
    spCertificate: v.optional(v.string()),
    wantAssertionsSigned: v.optional(v.boolean()),
    wantAssertionsEncrypted: v.optional(v.boolean()),
    attributeMappings: v.optional(attributeMappingValidator),
    ...provisioningArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const samlConfig = {
      idpEntityId: args.idpEntityId,
      idpSsoUrl: args.idpSsoUrl,
      idpCertificate: args.idpCertificate,
      spPrivateKeyEncrypted: args.spPrivateKeyEncrypted,
      spCertificate: args.spCertificate,
      wantAssertionsSigned: args.wantAssertionsSigned,
      wantAssertionsEncrypted: args.wantAssertionsEncrypted,
      attributeMappings: args.attributeMappings,
    };
    const provisioning = {
      autoProvisionRole: args.autoProvisionRole,
      defaultRole: args.defaultRole,
      roleMappingRules: args.roleMappingRules,
      autoProvisionTeam: args.autoProvisionTeam,
      excludeGroups: args.excludeGroups,
    };
    const row = await getRow(ctx, args.organizationId);
    if (row) {
      await ctx.db.patch(row._id, {
        protocol: 'saml',
        displayName: args.displayName,
        domain: args.domain,
        enabled: true,
        samlConfig,
        oidcConfig: undefined,
        ...provisioning,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('ssoConnections', {
        organizationId: args.organizationId,
        protocol: 'saml',
        displayName: args.displayName,
        domain: args.domain,
        enabled: true,
        samlConfig,
        ...provisioning,
        ...freshScimDefaults(),
        createdBy: args.actorId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: auditActor(args.actorId, args.actorEmail, args.actorRole),
      },
      action: 'sso_configure',
      category: 'security',
      resourceType: 'sso',
      resourceId: args.organizationId,
      newState: { protocol: 'saml' },
    });
    return null;
  },
});

export const writeProvisioning = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
    ...provisioningArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getRow(ctx, args.organizationId);
    const provisioning = {
      autoProvisionRole: args.autoProvisionRole,
      defaultRole: args.defaultRole,
      roleMappingRules: args.roleMappingRules,
      autoProvisionTeam: args.autoProvisionTeam,
      excludeGroups: args.excludeGroups,
    };
    const now = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { ...provisioning, updatedAt: now });
    } else {
      await ctx.db.insert('ssoConnections', {
        organizationId: args.organizationId,
        displayName: 'Enterprise SSO',
        enabled: false,
        ...provisioning,
        ...freshScimDefaults(),
        createdBy: args.actorId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const setSsoEnabled = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getRow(ctx, args.organizationId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: auditActor(args.actorId, args.actorEmail, args.actorRole),
      },
      action: args.enabled ? 'sso_enabled' : 'sso_disabled',
      category: 'security',
      resourceType: 'sso',
      resourceId: args.organizationId,
    });
    return null;
  },
});

export const removeConnection = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getRow(ctx, args.organizationId);
    if (!row) return null;
    await ctx.db.delete(row._id);
    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: auditActor(args.actorId, args.actorEmail, args.actorRole),
      },
      action: 'sso_removed',
      category: 'security',
      resourceType: 'sso',
      resourceId: args.organizationId,
    });
    return null;
  },
});
