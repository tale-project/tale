import { ConvexError, v } from 'convex/values';

import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
  type SsoConnectionFile,
  ssoConnectionFileSchema,
  type SsoConnectionView,
} from '../../../lib/shared/schemas/enterprise_sso';
// Raw `query` + explicit membership gate — matches the members/SCIM family
// (org membership is resolved via Better Auth's cross-component adapter).
import { type QueryCtx, query } from '../../_generated/server';
import { readConfigCacheRow } from '../../lib/config_cache/read';
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
 *
 * The non-secret config is read from the file-derived `configCache` (domain
 * `sso`, key `connection`); SCIM token state is read from the `ssoConnections`
 * DB row (token hash needs reverse lookup, so it stays in the DB). Every secret
 * (client secret, SP private key, SCIM token) is excluded; the client id is
 * revealed on demand via a separate action. Visible to any org member; the
 * settings route gates edit to developer/admin.
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
      authorizationEndpoint: v.optional(v.string()),
      tokenEndpoint: v.optional(v.string()),
      userinfoEndpoint: v.optional(v.string()),
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
  // Deployment env health the admin form warns on — a missing SITE_URL/secret
  // yields an empty callback URL and a raw 500 at sign-in (the real, hard-to-
  // debug failure). Optional so it can be absent in older/other callers.
  deployment: v.optional(
    v.object({
      siteUrlSet: v.boolean(),
      basePathSet: v.boolean(),
      authSecretSet: v.boolean(),
    }),
  ),
  // Another org on this deployment also has an enabled connection — without an
  // email domain this one is unroutable by address, so the form warns.
  otherOrgsEnabled: v.optional(v.boolean()),
});

/**
 * Deployment env prerequisites for SSO. Read server-side (the client cannot see
 * `BETTER_AUTH_SECRET`) so the admin form can warn before a live sign-in fails.
 * `BASE_PATH` is optional (empty is valid for a root deployment), so its flag
 * is informational — the form treats an empty BASE_PATH as fine.
 */
function deploymentHealth() {
  return {
    siteUrlSet: !!process.env.SITE_URL,
    basePathSet: process.env.BASE_PATH !== undefined,
    authSecretSet: !!process.env.BETTER_AUTH_SECRET,
  };
}

function publicBase(): string | null {
  try {
    return getPublicHttpApiUrl();
  } catch {
    return null;
  }
}

/** True when any OTHER org on this deployment has an enabled connection — the
 *  multi-org state where a domain-less connection is unroutable by email and
 *  only reachable via the login page's manual picker. */
async function otherOrgsHaveEnabledConnections(
  ctx: QueryCtx,
  organizationId: string,
): Promise<boolean> {
  for await (const row of ctx.db
    .query('configCache')
    .withIndex('by_domain_key', (q) =>
      q.eq('domain', SSO_CONFIG_DOMAIN).eq('key', SSO_CONNECTION_KEY),
    )) {
    if (row.organizationId === organizationId) continue;
    if (row.enabled !== true) continue;
    const parsed = ssoConnectionFileSchema.safeParse(row.config);
    if (parsed.success && parsed.data.enabled) return true;
  }
  return false;
}

export const get = query({
  args: { organizationId: v.string() },
  returns: connectionViewValidator,
  // Explicit return type breaks the Convex circular-type cascade (TS2719) that
  // a large validated query return otherwise triggers, and pins the view shape
  // to the shared `SsoConnectionView` the UI consumes.
  handler: async (ctx, args): Promise<SsoConnectionView> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Unauthenticated',
      });
    }
    const role = await getCallerRole(ctx, {
      organizationId: args.organizationId,
      userId: authUser.userId,
    });
    if (!role) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Not a member of this organization',
      });
    }

    const base = publicBase();
    const scimBaseUrl = base ? `${base}/scim/v2` : null;
    const samlSpMetadataUrl = base ? `${base}/api/sso/saml/metadata` : null;
    const samlAcsUrl = base ? `${base}/api/sso/saml/acs` : null;
    const oidcCallbackUrl = base ? `${base}/api/sso/callback` : null;

    // Non-secret connection config — file-derived mirror.
    const cacheRow = await readConfigCacheRow(
      ctx.db,
      args.organizationId,
      SSO_CONFIG_DOMAIN,
      SSO_CONNECTION_KEY,
    );
    const parsed = cacheRow
      ? ssoConnectionFileSchema.safeParse(cacheRow.config)
      : null;
    const config: SsoConnectionFile | null =
      parsed && parsed.success ? parsed.data : null;

    // SCIM token state — DB (reverse lookup by hash needs an index).
    const scimRow = await ctx.db
      .query('ssoConnections')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .first();

    const scim = {
      enabled: scimRow?.scimEnabled ?? false,
      tokenPrefix: scimRow?.scimEnabled
        ? (scimRow.scimTokenPrefix ?? null)
        : null,
      tokenGeneratedAt: scimRow?.scimEnabled
        ? (scimRow.scimTokenGeneratedAt ?? null)
        : null,
      lastUsedAt: scimRow?.scimLastUsedAt ?? null,
      baseUrl: scimBaseUrl,
    };

    const otherOrgsEnabled = await otherOrgsHaveEnabledConnections(
      ctx,
      args.organizationId,
    );

    if (!config) {
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
        scim,
        samlSpMetadataUrl,
        samlAcsUrl,
        oidcCallbackUrl,
        deployment: deploymentHealth(),
        otherOrgsEnabled,
      };
    }

    return {
      configured: true,
      enabled: config.enabled,
      protocol: config.protocol ?? null,
      displayName: config.displayName,
      domain: config.domain ?? null,
      oidc: config.oidc
        ? {
            providerId: config.oidc.providerId,
            issuer: config.oidc.issuer,
            authorizationEndpoint: config.oidc.authorizationEndpoint,
            tokenEndpoint: config.oidc.tokenEndpoint,
            userinfoEndpoint: config.oidc.userinfoEndpoint,
            scopes: config.oidc.scopes,
            pkce: config.oidc.pkce,
            domainHint: config.oidc.domainHint,
            claimMappings: config.oidc.claimMappings,
            enableOneDriveAccess: config.oidc.enableOneDriveAccess,
          }
        : null,
      saml: config.saml
        ? {
            idpEntityId: config.saml.idpEntityId,
            idpSsoUrl: config.saml.idpSsoUrl,
            idpCertificate: config.saml.idpCertificate,
            wantAssertionsSigned: config.saml.wantAssertionsSigned,
            wantAssertionsEncrypted: config.saml.wantAssertionsEncrypted,
            // The SP private key lives in the secrets sidecar (not the cache);
            // a configured public SP certificate signals the keypair exists.
            hasSpKeypair: !!config.saml.spCertificate,
            spCertificate: config.saml.spCertificate,
            attributeMappings: config.saml.attributeMappings,
          }
        : null,
      provisioning: {
        autoProvisionRole: config.provisioning.autoProvisionRole,
        defaultRole: config.provisioning.defaultRole,
        roleMappingRules: config.provisioning.roleMappingRules,
        autoProvisionTeam: config.provisioning.autoProvisionTeam,
        excludeGroups: config.provisioning.excludeGroups,
      },
      scim,
      samlSpMetadataUrl,
      samlAcsUrl,
      oidcCallbackUrl,
      deployment: deploymentHealth(),
      otherOrgsEnabled,
    };
  },
});
