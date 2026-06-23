import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import {
  attributeMappingValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  ssoProviderIdValidator,
  ssoProtocolValidator,
} from './validators';

/**
 * Internal reads for the unified SSO sign-in flow. The login handlers resolve
 * the org's connection here (the single enabled one) and operate entirely on
 * the returned shape — the connection row IS the source of truth.
 */

const resolvedSignInConfigValidator = v.object({
  organizationId: v.string(),
  providerId: ssoProviderIdValidator,
  issuer: v.string(),
  authorizationEndpoint: v.optional(v.string()),
  tokenEndpoint: v.optional(v.string()),
  userinfoEndpoint: v.optional(v.string()),
  clientIdEncrypted: v.string(),
  clientSecretEncrypted: v.string(),
  scopes: v.array(v.string()),
  pkce: v.boolean(),
  claimMappings: v.optional(attributeMappingValidator),
  domainHint: v.optional(v.string()),
  enableOneDriveAccess: v.optional(v.boolean()),
  autoProvisionRole: v.boolean(),
  roleMappingRules: v.array(roleMappingRuleValidator),
  defaultRole: platformRoleValidator,
  autoProvisionTeam: v.boolean(),
  excludeGroups: v.array(v.string()),
});

/**
 * Resolve the org's OIDC/OAuth2 sign-in config (decryptable secrets returned as
 * ciphertext). Returns null when no enabled OIDC/OAuth2 connection exists.
 * When `organizationId` is omitted, resolves the single enabled connection
 * (single-org deployments / email-first discovery).
 */
export const resolveSignInConfig = internalQuery({
  args: { organizationId: v.optional(v.string()) },
  returns: v.union(resolvedSignInConfigValidator, v.null()),
  handler: async (ctx, args) => {
    const orgId = args.organizationId;
    const row = orgId
      ? await ctx.db
          .query('ssoConnections')
          .withIndex('by_org', (q) => q.eq('organizationId', orgId))
          .first()
      : await ctx.db
          .query('ssoConnections')
          .filter((q) => q.eq(q.field('enabled'), true))
          .first();

    if (!row || !row.enabled || !row.oidcConfig) return null;
    const c = row.oidcConfig;
    return {
      organizationId: row.organizationId,
      providerId: c.providerId,
      issuer: c.issuer,
      authorizationEndpoint: c.authorizationEndpoint,
      tokenEndpoint: c.tokenEndpoint,
      userinfoEndpoint: c.userinfoEndpoint,
      clientIdEncrypted: c.clientIdEncrypted,
      clientSecretEncrypted: c.clientSecretEncrypted,
      scopes: c.scopes,
      pkce: c.pkce ?? false,
      claimMappings: c.claimMappings,
      domainHint: c.domainHint,
      enableOneDriveAccess: c.enableOneDriveAccess,
      autoProvisionRole: row.autoProvisionRole,
      roleMappingRules: row.roleMappingRules,
      defaultRole: row.defaultRole,
      autoProvisionTeam: row.autoProvisionTeam,
      excludeGroups: row.excludeGroups,
    };
  },
});

const provisioningValidator = v.object({
  organizationId: v.string(),
  autoProvisionRole: v.boolean(),
  defaultRole: platformRoleValidator,
  roleMappingRules: v.array(roleMappingRuleValidator),
  autoProvisionTeam: v.boolean(),
  excludeGroups: v.array(v.string()),
});

/**
 * Resolve the org's provisioning policy (role mapping + team sync), regardless
 * of sign-in protocol. The shared login orchestrator uses this so OIDC, OAuth2,
 * and SAML all apply the same role/team rules. Returns safe defaults when no
 * connection exists.
 */
export const resolveProvisioning = internalQuery({
  args: { organizationId: v.string() },
  returns: provisioningValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('ssoConnections')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .first();
    return {
      organizationId: args.organizationId,
      autoProvisionRole: row?.autoProvisionRole ?? false,
      defaultRole: row?.defaultRole ?? 'member',
      roleMappingRules: row?.roleMappingRules ?? [],
      autoProvisionTeam: row?.autoProvisionTeam ?? false,
      excludeGroups: row?.excludeGroups ?? [],
    };
  },
});

/**
 * Resolve the SAML config (with decryptable SP key as ciphertext) for the ACS
 * handler. Returns null when no enabled SAML connection exists.
 */
export const resolveSamlConfig = internalQuery({
  args: { organizationId: v.optional(v.string()) },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      idpEntityId: v.string(),
      idpSsoUrl: v.string(),
      idpCertificate: v.string(),
      spPrivateKeyEncrypted: v.optional(v.string()),
      spCertificate: v.optional(v.string()),
      wantAssertionsSigned: v.optional(v.boolean()),
      wantAssertionsEncrypted: v.optional(v.boolean()),
      attributeMappings: v.optional(attributeMappingValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const orgId = args.organizationId;
    const row = orgId
      ? await ctx.db
          .query('ssoConnections')
          .withIndex('by_org', (q) => q.eq('organizationId', orgId))
          .first()
      : await ctx.db
          .query('ssoConnections')
          .filter((q) => q.eq(q.field('enabled'), true))
          .first();
    if (!row || !row.enabled || !row.samlConfig) return null;
    const s = row.samlConfig;
    return {
      organizationId: row.organizationId,
      idpEntityId: s.idpEntityId,
      idpSsoUrl: s.idpSsoUrl,
      idpCertificate: s.idpCertificate,
      spPrivateKeyEncrypted: s.spPrivateKeyEncrypted,
      spCertificate: s.spCertificate,
      wantAssertionsSigned: s.wantAssertionsSigned,
      wantAssertionsEncrypted: s.wantAssertionsEncrypted,
      attributeMappings: s.attributeMappings,
    };
  },
});

/**
 * Discovery for the login screen: is SSO enabled, and for which org/protocol?
 * Routes by email domain when set, else falls back to the single enabled
 * connection. Returns null when no enabled connection exists.
 */
export const discoverByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      protocol: ssoProtocolValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const domain = args.email.split('@')[1]?.toLowerCase();
    let row = null;
    if (domain) {
      row = await ctx.db
        .query('ssoConnections')
        .withIndex('by_domain', (q) => q.eq('domain', domain))
        .first();
    }
    if (!row || !row.enabled) {
      row = await ctx.db
        .query('ssoConnections')
        .filter((q) => q.eq(q.field('enabled'), true))
        .first();
    }
    if (!row || !row.enabled || !row.protocol) return null;
    return { organizationId: row.organizationId, protocol: row.protocol };
  },
});
