import { v } from 'convex/values';

import type { SsoConnectionView } from '../../../lib/shared/schemas/enterprise_sso';
// Raw `query` + explicit membership gate — matches the members/SCIM family
// (org membership is resolved via Better Auth's cross-component adapter).
import { query } from '../../_generated/server';
import { getPublicHttpApiUrl } from '../../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';
import { getCallerRole } from '../get_caller_role';
import {
  attributeMappingValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  ssoProtocolValidator,
  ssoProviderIdValidator,
} from '../validators';

/**
 * Read-facing view of the org's unified SSO connection for the settings UI.
 * Strips every secret (client secret, SP private key, SCIM token hash) and the
 * decryptable `clientId` (revealed on demand via a separate action). Visible to
 * any org member; the settings route gates edit to developer/admin.
 */
const connectionViewValidator = v.object({
  configured: v.boolean(),
  enabled: v.boolean(),
  protocol: v.union(ssoProtocolValidator, v.null()),
  displayName: v.union(v.string(), v.null()),
  domain: v.union(v.string(), v.null()),
  oidc: v.union(
    v.object({
      providerId: ssoProviderIdValidator,
      issuer: v.string(),
      scopes: v.array(v.string()),
      pkce: v.optional(v.boolean()),
      domainHint: v.optional(v.string()),
      claimMappings: v.optional(attributeMappingValidator),
      enableOneDriveAccess: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  saml: v.union(
    v.object({
      idpEntityId: v.string(),
      idpSsoUrl: v.string(),
      idpCertificate: v.string(),
      wantAssertionsSigned: v.optional(v.boolean()),
      wantAssertionsEncrypted: v.optional(v.boolean()),
      hasSpKeypair: v.boolean(),
      spCertificate: v.optional(v.string()),
      attributeMappings: v.optional(attributeMappingValidator),
    }),
    v.null(),
  ),
  provisioning: v.object({
    autoProvisionRole: v.boolean(),
    defaultRole: platformRoleValidator,
    roleMappingRules: v.array(roleMappingRuleValidator),
    autoProvisionTeam: v.boolean(),
    excludeGroups: v.array(v.string()),
  }),
  scim: v.object({
    enabled: v.boolean(),
    tokenPrefix: v.union(v.string(), v.null()),
    tokenGeneratedAt: v.union(v.number(), v.null()),
    lastUsedAt: v.union(v.number(), v.null()),
    baseUrl: v.union(v.string(), v.null()),
  }),
  samlSpMetadataUrl: v.union(v.string(), v.null()),
  samlAcsUrl: v.union(v.string(), v.null()),
  oidcCallbackUrl: v.union(v.string(), v.null()),
});

function publicBase(): string | null {
  try {
    return getPublicHttpApiUrl();
  } catch {
    return null;
  }
}

export const get = query({
  args: { organizationId: v.string() },
  returns: connectionViewValidator,
  // Explicit return type breaks the Convex circular-type cascade (TS2719) that
  // a large validated query return otherwise triggers, and pins the view shape
  // to the shared `SsoConnectionView` the UI consumes.
  handler: async (ctx, args): Promise<SsoConnectionView> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const role = await getCallerRole(ctx, {
      organizationId: args.organizationId,
      userId: authUser.userId,
    });
    if (!role) throw new Error('Not a member of this organization');

    const base = publicBase();
    const scimBaseUrl = base ? `${base}/scim/v2` : null;
    const samlSpMetadataUrl = base ? `${base}/api/sso/saml/metadata` : null;
    const samlAcsUrl = base ? `${base}/api/sso/saml/acs` : null;
    const oidcCallbackUrl = base ? `${base}/api/sso/callback` : null;

    const row = await ctx.db
      .query('ssoConnections')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .first();

    if (!row) {
      return {
        configured: false,
        enabled: false,
        protocol: null,
        displayName: null,
        domain: null,
        oidc: null,
        saml: null,
        provisioning: {
          autoProvisionRole: false,
          defaultRole: 'member' as const,
          roleMappingRules: [],
          autoProvisionTeam: false,
          excludeGroups: [],
        },
        scim: {
          enabled: false,
          tokenPrefix: null,
          tokenGeneratedAt: null,
          lastUsedAt: null,
          baseUrl: scimBaseUrl,
        },
        samlSpMetadataUrl,
        samlAcsUrl,
        oidcCallbackUrl,
      };
    }

    return {
      configured: true,
      enabled: row.enabled,
      protocol: row.protocol ?? null,
      displayName: row.displayName,
      domain: row.domain ?? null,
      oidc: row.oidcConfig
        ? {
            providerId: row.oidcConfig.providerId,
            issuer: row.oidcConfig.issuer,
            scopes: row.oidcConfig.scopes,
            pkce: row.oidcConfig.pkce,
            domainHint: row.oidcConfig.domainHint,
            claimMappings: row.oidcConfig.claimMappings,
            enableOneDriveAccess: row.oidcConfig.enableOneDriveAccess,
          }
        : null,
      saml: row.samlConfig
        ? {
            idpEntityId: row.samlConfig.idpEntityId,
            idpSsoUrl: row.samlConfig.idpSsoUrl,
            idpCertificate: row.samlConfig.idpCertificate,
            wantAssertionsSigned: row.samlConfig.wantAssertionsSigned,
            wantAssertionsEncrypted: row.samlConfig.wantAssertionsEncrypted,
            hasSpKeypair: !!row.samlConfig.spPrivateKeyEncrypted,
            spCertificate: row.samlConfig.spCertificate,
            attributeMappings: row.samlConfig.attributeMappings,
          }
        : null,
      provisioning: {
        autoProvisionRole: row.autoProvisionRole,
        defaultRole: row.defaultRole,
        roleMappingRules: row.roleMappingRules,
        autoProvisionTeam: row.autoProvisionTeam,
        excludeGroups: row.excludeGroups,
      },
      scim: {
        enabled: row.scimEnabled,
        tokenPrefix: row.scimEnabled ? row.scimTokenPrefix : null,
        tokenGeneratedAt: row.scimEnabled
          ? (row.scimTokenGeneratedAt ?? null)
          : null,
        lastUsedAt: row.scimLastUsedAt ?? null,
        baseUrl: scimBaseUrl,
      },
      samlSpMetadataUrl,
      samlAcsUrl,
      oidcCallbackUrl,
    };
  },
});
