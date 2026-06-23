import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action, type ActionCtx } from '../../_generated/server';
import { decryptString } from '../../lib/crypto/decrypt_string';
import { encryptString } from '../../lib/crypto/encrypt_string';
import { isAdmin } from '../../lib/rls/helpers/role_helpers';
import { getAdapter } from '../registry';
import {
  attributeMappingValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  ssoProviderIdValidator,
} from '../validators';

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
  if (!authUser) throw new Error('Unauthenticated');
  const role = await ctx.runQuery(
    internal.enterprise_sso.config.internal_queries.getCallerRole,
    { organizationId, userId: authUser._id },
  );
  if (!isAdmin(role)) {
    throw new Error('Only admins can configure SSO');
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

    let clientIdEncrypted: string;
    let clientSecretEncrypted: string;
    if (args.clientSecret) {
      clientIdEncrypted = await encryptString(args.clientId);
      clientSecretEncrypted = await encryptString(args.clientSecret);
    } else {
      const existing = await ctx.runQuery(
        internal.enterprise_sso.config.internal_queries.getConnectionSecrets,
        { organizationId: args.organizationId },
      );
      if (!existing?.clientSecretEncrypted) {
        throw new Error('Client secret is required for a new configuration');
      }
      // Re-encrypt the (possibly changed) clientId; reuse the stored secret.
      clientIdEncrypted = await encryptString(args.clientId);
      clientSecretEncrypted = existing.clientSecretEncrypted;
    }

    await ctx.runMutation(
      internal.enterprise_sso.config.internal_mutations.writeOidc,
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
        clientIdEncrypted,
        clientSecretEncrypted,
        scopes: args.scopes,
        pkce: args.pkce,
        claimMappings: args.claimMappings,
        domainHint: args.domainHint,
        enableOneDriveAccess: args.enableOneDriveAccess,
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

    let spPrivateKeyEncrypted: string | undefined;
    if (args.spPrivateKey) {
      spPrivateKeyEncrypted = await encryptString(args.spPrivateKey);
    } else {
      const existing = await ctx.runQuery(
        internal.enterprise_sso.config.internal_queries.getConnectionSecrets,
        { organizationId: args.organizationId },
      );
      spPrivateKeyEncrypted = existing?.spPrivateKeyEncrypted;
    }

    await ctx.runMutation(
      internal.enterprise_sso.config.internal_mutations.writeSaml,
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
        spPrivateKeyEncrypted,
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

/** Update only the provisioning policy (role mapping, team sync, default role). */
export const setProvisioning = action({
  args: { organizationId: v.string(), ...provisioningArgs },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runMutation(
      internal.enterprise_sso.config.internal_mutations.writeProvisioning,
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
    const secrets = await ctx.runQuery(
      internal.enterprise_sso.config.internal_queries.getConnectionSecrets,
      { organizationId: args.organizationId },
    );
    if (!secrets?.clientIdEncrypted) return null;
    return decryptString(secrets.clientIdEncrypted);
  },
});

/** Disable SSO sign-in (keeps the config for re-enable; SCIM unaffected). */
export const disableSso = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runMutation(
      internal.enterprise_sso.config.internal_mutations.setSsoEnabled,
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

/** Remove the entire connection (SSO + SCIM). */
export const remove = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireAdmin(ctx, args.organizationId);
    await ctx.runMutation(
      internal.enterprise_sso.config.internal_mutations.removeConnection,
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
