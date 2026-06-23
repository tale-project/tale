import { v } from 'convex/values';

import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
  type SsoConnectionFile,
  ssoConnectionFileSchema,
} from '../../lib/shared/schemas/enterprise_sso';
import { type QueryCtx, internalQuery } from '../_generated/server';
import { readConfigCacheRow } from '../lib/config_cache/read';
import {
  attributeMappingValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  ssoProviderIdValidator,
  ssoProtocolValidator,
} from './validators';

/**
 * Internal reads for the unified SSO sign-in flow.
 *
 * The connection config is file-based (source of truth on disk), mirrored into
 * `configCache` (domain `sso`, key `connection`); these V8 reads return the
 * NON-SECRET config from that mirror. Secrets (client secret, SP private key)
 * live in the `connection.secrets.json` sidecar and are read by the `'use node'`
 * sign-in adapters via `config/file_actions.getConnectionSecrets`.
 */

interface LoadedConnection {
  organizationId: string;
  config: SsoConnectionFile;
}

/** Load + validate one org's connection from the cache mirror. */
async function loadConnection(
  ctx: QueryCtx,
  organizationId: string,
): Promise<LoadedConnection | null> {
  const row = await readConfigCacheRow(
    ctx.db,
    organizationId,
    SSO_CONFIG_DOMAIN,
    SSO_CONNECTION_KEY,
  );
  if (!row) return null;
  const parsed = ssoConnectionFileSchema.safeParse(row.config);
  if (!parsed.success) return null;
  return { organizationId, config: parsed.data };
}

/** First ENABLED connection across orgs (single-org deployments / email-first
 *  discovery). Ranges the `(domain, key)` slice of `configCache`. */
async function loadSingleEnabled(
  ctx: QueryCtx,
): Promise<LoadedConnection | null> {
  for await (const row of ctx.db
    .query('configCache')
    .withIndex('by_domain_key', (q) =>
      q.eq('domain', SSO_CONFIG_DOMAIN).eq('key', SSO_CONNECTION_KEY),
    )) {
    if (row.enabled !== true) continue;
    const parsed = ssoConnectionFileSchema.safeParse(row.config);
    if (parsed.success && parsed.data.enabled) {
      return { organizationId: row.organizationId, config: parsed.data };
    }
  }
  return null;
}

const resolvedSignInConfigValidator = v.object({
  organizationId: v.string(),
  providerId: ssoProviderIdValidator,
  issuer: v.string(),
  authorizationEndpoint: v.optional(v.string()),
  tokenEndpoint: v.optional(v.string()),
  userinfoEndpoint: v.optional(v.string()),
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
 * Resolve the org's OIDC/OAuth2 sign-in config (NON-secret). Returns null when
 * no enabled OIDC/OAuth2 connection exists. When `organizationId` is omitted,
 * resolves the single enabled connection. The caller fetches the client id /
 * secret separately from the secrets sidecar.
 */
export const resolveSignInConfig = internalQuery({
  args: { organizationId: v.optional(v.string()) },
  returns: v.union(resolvedSignInConfigValidator, v.null()),
  handler: async (ctx, args) => {
    const conn = args.organizationId
      ? await loadConnection(ctx, args.organizationId)
      : await loadSingleEnabled(ctx);
    if (!conn || !conn.config.enabled || !conn.config.oidc) return null;
    const c = conn.config.oidc;
    const p = conn.config.provisioning;
    return {
      organizationId: conn.organizationId,
      providerId: c.providerId,
      issuer: c.issuer,
      authorizationEndpoint: c.authorizationEndpoint,
      tokenEndpoint: c.tokenEndpoint,
      userinfoEndpoint: c.userinfoEndpoint,
      scopes: c.scopes,
      pkce: c.pkce ?? false,
      claimMappings: c.claimMappings,
      domainHint: c.domainHint,
      enableOneDriveAccess: c.enableOneDriveAccess,
      autoProvisionRole: p.autoProvisionRole,
      roleMappingRules: p.roleMappingRules,
      defaultRole: p.defaultRole,
      autoProvisionTeam: p.autoProvisionTeam,
      excludeGroups: p.excludeGroups,
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
    const conn = await loadConnection(ctx, args.organizationId);
    const p = conn?.config.provisioning;
    return {
      organizationId: args.organizationId,
      autoProvisionRole: p?.autoProvisionRole ?? false,
      defaultRole: p?.defaultRole ?? 'member',
      roleMappingRules: p?.roleMappingRules ?? [],
      autoProvisionTeam: p?.autoProvisionTeam ?? false,
      excludeGroups: p?.excludeGroups ?? [],
    };
  },
});

/**
 * Resolve the SAML config (NON-secret) for the ACS / metadata handlers. Returns
 * null when no enabled SAML connection exists. The SP private key is fetched
 * separately from the secrets sidecar by the ACS handler.
 */
export const resolveSamlConfig = internalQuery({
  args: { organizationId: v.optional(v.string()) },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      idpEntityId: v.string(),
      idpSsoUrl: v.string(),
      idpCertificate: v.string(),
      spCertificate: v.optional(v.string()),
      wantAssertionsSigned: v.optional(v.boolean()),
      wantAssertionsEncrypted: v.optional(v.boolean()),
      attributeMappings: v.optional(attributeMappingValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const conn = args.organizationId
      ? await loadConnection(ctx, args.organizationId)
      : await loadSingleEnabled(ctx);
    if (!conn || !conn.config.enabled || !conn.config.saml) return null;
    const s = conn.config.saml;
    return {
      organizationId: conn.organizationId,
      idpEntityId: s.idpEntityId,
      idpSsoUrl: s.idpSsoUrl,
      idpCertificate: s.idpCertificate,
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
    let firstEnabled: LoadedConnection | null = null;
    let domainMatch: LoadedConnection | null = null;
    for await (const row of ctx.db
      .query('configCache')
      .withIndex('by_domain_key', (q) =>
        q.eq('domain', SSO_CONFIG_DOMAIN).eq('key', SSO_CONNECTION_KEY),
      )) {
      if (row.enabled !== true) continue;
      const parsed = ssoConnectionFileSchema.safeParse(row.config);
      if (!parsed.success || !parsed.data.enabled || !parsed.data.protocol) {
        continue;
      }
      const conn = { organizationId: row.organizationId, config: parsed.data };
      if (!firstEnabled) firstEnabled = conn;
      if (domain && parsed.data.domain?.toLowerCase() === domain) {
        domainMatch = conn;
        break;
      }
    }
    const chosen = domainMatch ?? firstEnabled;
    if (!chosen || !chosen.config.protocol) return null;
    return {
      organizationId: chosen.organizationId,
      protocol: chosen.config.protocol,
    };
  },
});
