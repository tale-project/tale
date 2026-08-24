import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action, type ActionCtx } from '../../_generated/server';
import { isAdmin } from '../../lib/rls/helpers/role_helpers';
import { getAdapter } from '../registry';
import {
  attributeMappingValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  ssoProviderIdValidator,
} from '../validators';

/**
 * Admin-gated public actions for the file-backed SSO connection. Each one
 * authenticates the caller, then delegates the file write (and the
 * `configCache` mirror) to the `'use node'` `config/file_actions.ts`. The
 * connection config lives in per-org JSON files — no DB row carries it.
 */

interface Caller {
  userId: string;
  email: string;
  role: string;
}

async function requireAdmin(
  ctx: ActionCtx,
  organizationId: string,
): Promise<Caller> {
  const authUser = await ctx.runQuery(
    internal.enterprise_sso.config.internal_queries.getAuthUser,
    {},
  );
  if (!authUser) {
    throw new ConvexError({
      code: 'unauthenticated',
      message: 'Unauthenticated',
    });
  }
  const role = await ctx.runQuery(
    internal.enterprise_sso.config.internal_queries.getCallerRole,
    { organizationId, userId: authUser._id },
  );
  if (!isAdmin(role)) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Only admins can configure SSO',
    });
  }
  return { userId: authUser._id, email: authUser.email, role: role ?? 'admin' };
}

const provisioningArgs = {
  autoProvisionRole: v.boolean(),
  defaultRole: platformRoleValidator,
  roleMappingRules: v.array(roleMappingRuleValidator),
  autoProvisionTeam: v.boolean(),
  excludeGroups: v.array(v.string()),
};

/** Configure (or update) an OIDC/OAuth2 sign-in connection + provisioning. */
export const upsertOidc = action({
  args: {
    organizationId: v.string(),
    displayName: v.string(),
    domain: v.optional(v.string()),
    providerId: ssoProviderIdValidator,
    issuer: v.string(),
    authorizationEndpoint: v.optional(v.string()),
    tokenEndpoint: v.optional(v.string()),
    userinfoEndpoint: v.optional(v.string()),
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    scopes: v.array(v.string()),
    pkce: v.optional(v.boolean()),
    claimMappings: v.optional(attributeMappingValidator),
    domainHint: v.optional(v.string()),
    enableOneDriveAccess: v.optional(v.boolean()),
    ...provisioningArgs,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.writeOidcConnection,
      {
        organizationId: args.organizationId,
        actorId: caller.userId,
        actorEmail: caller.email,
        actorRole: caller.role,
        displayName: args.displayName,
        domain: args.domain,
        providerId: args.providerId,
        issuer: args.issuer,
        authorizationEndpoint: args.authorizationEndpoint,
        tokenEndpoint: args.tokenEndpoint,
        userinfoEndpoint: args.userinfoEndpoint,
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        scopes: args.scopes,
        pkce: args.pkce,
        claimMappings: args.claimMappings,
        domainHint: args.domainHint,
        // Deprecated — always clear. File import uses Knowledge cloud-import.
        enableOneDriveAccess: false,
        autoProvisionRole: args.autoProvisionRole,
        defaultRole: args.defaultRole,
        roleMappingRules: args.roleMappingRules,
        autoProvisionTeam: args.autoProvisionTeam,
        excludeGroups: args.excludeGroups,
      },
    );
    return null;
  },
});

/** Configure (or update) a SAML 2.0 sign-in connection + provisioning. */
export const upsertSaml = action({
  args: {
    organizationId: v.string(),
    displayName: v.string(),
    domain: v.optional(v.string()),
    idpEntityId: v.string(),
    idpSsoUrl: v.string(),
    idpCertificate: v.string(),
    spPrivateKey: v.optional(v.string()),
    spCertificate: v.optional(v.string()),
    wantAssertionsSigned: v.optional(v.boolean()),
    wantAssertionsEncrypted: v.optional(v.boolean()),
    attributeMappings: v.optional(attributeMappingValidator),
    ...provisioningArgs,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.writeSamlConnection,
      {
        organizationId: args.organizationId,
        actorId: caller.userId,
        actorEmail: caller.email,
        actorRole: caller.role,
        displayName: args.displayName,
        domain: args.domain,
        idpEntityId: args.idpEntityId,
        idpSsoUrl: args.idpSsoUrl,
        idpCertificate: args.idpCertificate,
        spPrivateKey: args.spPrivateKey,
        spCertificate: args.spCertificate,
        wantAssertionsSigned: args.wantAssertionsSigned,
        wantAssertionsEncrypted: args.wantAssertionsEncrypted,
        attributeMappings: args.attributeMappings,
        autoProvisionRole: args.autoProvisionRole,
        defaultRole: args.defaultRole,
        roleMappingRules: args.roleMappingRules,
        autoProvisionTeam: args.autoProvisionTeam,
        excludeGroups: args.excludeGroups,
      },
    );
    return null;
  },
});

/**
 * Parse IdP federation metadata (URL or uploaded XML) into the three SAML
 * fields the form asks for, so admins never hand-copy a certificate (#2652).
 * Parsing runs server-side behind the admin gate: the metadata is untrusted
 * input, so it crosses `safeFetch` (SSRF/size) + the parser's own byte cap in
 * the `'use node'` SAML module. Returns the parsed values for the form to
 * prefill — nothing is persisted here; saving stays an explicit review step.
 */
export const parseIdpMetadata = action({
  args: {
    organizationId: v.string(),
    url: v.optional(v.string()),
    xml: v.optional(v.string()),
  },
  returns: v.object({
    idpEntityId: v.string(),
    idpSsoUrl: v.string(),
    idpCertificate: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);
    if ((args.url === undefined) === (args.xml === undefined)) {
      throw new ConvexError({
        code: 'sso_metadata_invalid',
        message: 'Provide exactly one of url or xml',
      });
    }
    const result: {
      ok: boolean;
      error?: string;
      idpEntityId?: string;
      idpSsoUrl?: string;
      idpCertificate?: string;
    } = await ctx.runAction(
      internal.enterprise_sso.saml.parse_metadata.fetchAndParseIdpMetadata,
      { url: args.url, xml: args.xml },
    );
    if (
      !result.ok ||
      result.idpEntityId === undefined ||
      result.idpSsoUrl === undefined ||
      result.idpCertificate === undefined
    ) {
      // Stable per-kind codes the form maps to localized messages.
      throw new ConvexError({
        code: `sso_metadata_${result.error ?? 'invalid'}`,
        message: 'Could not read IdP metadata',
      });
    }
    return {
      idpEntityId: result.idpEntityId,
      idpSsoUrl: result.idpSsoUrl,
      idpCertificate: result.idpCertificate,
    };
  },
});

/** Update only the provisioning policy (role mapping, team sync, default role). */
export const setProvisioning = action({
  args: { organizationId: v.string(), ...provisioningArgs },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.writeProvisioning,
      {
        organizationId: args.organizationId,
        actorId: caller.userId,
        actorEmail: caller.email,
        actorRole: caller.role,
        autoProvisionRole: args.autoProvisionRole,
        defaultRole: args.defaultRole,
        roleMappingRules: args.roleMappingRules,
        autoProvisionTeam: args.autoProvisionTeam,
        excludeGroups: args.excludeGroups,
      },
    );
    return null;
  },
});

/** Validate an OIDC/OAuth2 config (discovery / endpoint reachability). */
export const testConnection = action({
  args: {
    organizationId: v.string(),
    providerId: ssoProviderIdValidator,
    issuer: v.string(),
    authorizationEndpoint: v.optional(v.string()),
    tokenEndpoint: v.optional(v.string()),
    userinfoEndpoint: v.optional(v.string()),
    clientId: v.string(),
    scopes: v.array(v.string()),
  },
  returns: v.object({ valid: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);
    const adapter = getAdapter(args.providerId);
    if (!adapter) return { valid: false, error: 'Unknown provider' };
    return adapter.validateConfig({
      providerId: args.providerId,
      issuer: args.issuer,
      authorizationEndpoint: args.authorizationEndpoint,
      tokenEndpoint: args.tokenEndpoint,
      userinfoEndpoint: args.userinfoEndpoint,
      clientId: args.clientId,
      scopes: args.scopes,
    });
  },
});

/** Reveal the stored client id for the edit form (admin-only). */
export const revealOidcClientId = action({
  args: { organizationId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    await requireAdmin(ctx, args.organizationId);
    return ctx.runAction(
      internal.enterprise_sso.config.file_actions.revealClientId,
      { organizationId: args.organizationId },
    );
  },
});

/** Disable SSO sign-in (keeps the config for re-enable; SCIM unaffected). */
export const disableSso = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.setEnabled,
      {
        organizationId: args.organizationId,
        actorId: caller.userId,
        actorEmail: caller.email,
        actorRole: caller.role,
        enabled: false,
      },
    );
    return null;
  },
});

/** Remove the entire sign-in connection (config + secrets; SCIM token separate). */
export const remove = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.removeConnection,
      {
        organizationId: args.organizationId,
        actorId: caller.userId,
        actorEmail: caller.email,
        actorRole: caller.role,
      },
    );
    return null;
  },
});
