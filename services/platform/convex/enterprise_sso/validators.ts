import { v } from 'convex/values';

/**
 * Convex validators for the unified Enterprise SSO model. Mirrors
 * `lib/shared/schemas/enterprise_sso.ts`. Stored configs carry ENCRYPTED
 * secrets (`*Encrypted` fields); the read-facing config queries strip them.
 */

export const platformRoleValidator = v.union(
  v.literal('admin'),
  v.literal('developer'),
  v.literal('editor'),
  v.literal('member'),
  v.literal('disabled'),
);

export const ssoProtocolValidator = v.union(
  v.literal('oidc'),
  v.literal('oauth2'),
  v.literal('saml'),
);

export const roleMappingSourceValidator = v.union(
  v.literal('jobTitle'),
  v.literal('appRole'),
  v.literal('group'),
  v.literal('claim'),
);

export const roleMappingRuleValidator = v.object({
  source: roleMappingSourceValidator,
  pattern: v.string(),
  targetRole: platformRoleValidator,
  claim: v.optional(v.string()),
});

export const attributeMappingValidator = v.object({
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  groups: v.optional(v.string()),
});

export const ssoProviderIdValidator = v.union(
  v.literal('entra-id'),
  v.literal('generic-oidc'),
  v.literal('oauth2'),
);

/** OIDC/OAuth2 config as stored (secrets encrypted). */
export const oidcStoredConfigValidator = v.object({
  // Selects the concrete adapter (Entra Graph vs discovery-driven OIDC vs OAuth2).
  providerId: ssoProviderIdValidator,
  issuer: v.string(),
  // Explicit endpoints override OIDC discovery (required for non-OIDC OAuth2).
  authorizationEndpoint: v.optional(v.string()),
  tokenEndpoint: v.optional(v.string()),
  userinfoEndpoint: v.optional(v.string()),
  clientIdEncrypted: v.string(),
  clientSecretEncrypted: v.string(),
  scopes: v.array(v.string()),
  pkce: v.optional(v.boolean()),
  domainHint: v.optional(v.string()),
  claimMappings: v.optional(attributeMappingValidator),
  enableOneDriveAccess: v.optional(v.boolean()),
});

/** SAML config as stored (SP private key encrypted). */
export const samlStoredConfigValidator = v.object({
  idpEntityId: v.string(),
  idpSsoUrl: v.string(),
  idpCertificate: v.string(),
  spPrivateKeyEncrypted: v.optional(v.string()),
  spCertificate: v.optional(v.string()),
  wantAssertionsSigned: v.optional(v.boolean()),
  wantAssertionsEncrypted: v.optional(v.boolean()),
  attributeMappings: v.optional(attributeMappingValidator),
});

export const ssoResourceTypeValidator = v.union(
  v.literal('User'),
  v.literal('Group'),
);
