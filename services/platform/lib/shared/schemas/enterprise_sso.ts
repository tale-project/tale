import { z } from 'zod/v4';

/**
 * Unified Enterprise SSO + Provisioning schemas (frontend + backend).
 *
 * One connection per organization, protocol-discriminated. Replaces the old
 * `sso_providers` schema. Covers OIDC, OAuth2, and SAML 2.0 sign-in plus SCIM
 * provisioning, all on one record. Secrets (client secret, SP private key,
 * SCIM token) are NEVER part of the read-facing views below.
 */

// ---------------------------------------------------------------------------
// Roles + role mapping (shared with the platform RBAC)
// ---------------------------------------------------------------------------

const platformRoleLiterals = [
  'admin',
  'developer',
  'editor',
  'member',
  'disabled',
] as const;
export const platformRoleSchema = z.enum(platformRoleLiterals);
export type PlatformRole = z.infer<typeof platformRoleSchema>;

const roleMappingSourceLiterals = [
  'jobTitle',
  'appRole',
  'group',
  'claim',
] as const;
const roleMappingSourceSchema = z.enum(roleMappingSourceLiterals);
export type RoleMappingSource = z.infer<typeof roleMappingSourceSchema>;

export const roleMappingRuleSchema = z.object({
  source: roleMappingSourceSchema,
  pattern: z.string(),
  targetRole: platformRoleSchema,
  /** Dot-path into the raw claims/attributes (e.g. `realm_access.roles`). */
  claim: z.string().optional(),
});
export type RoleMappingRule = z.infer<typeof roleMappingRuleSchema>;

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

const ssoProtocolSchema = z.enum(['oidc', 'oauth2', 'saml']);
export type SsoProtocol = z.infer<typeof ssoProtocolSchema>;

// ---------------------------------------------------------------------------
// Normalized identity returned by every protocol's front-half, fed into the
// shared provisioning layer.
// ---------------------------------------------------------------------------

export const ssoAuthContextSchema = z.object({
  authContextClassRef: z.string().optional(),
  authMethodsRef: z.array(z.string()).optional(),
  mfaCompleted: z.boolean().optional(),
});
export type SsoAuthContext = z.infer<typeof ssoAuthContextSchema>;

export const ssoUserInfoSchema = z.object({
  externalId: z.string(),
  email: z.string(),
  name: z.string(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  companyName: z.string().optional(),
  customAttributes: z.record(z.string(), z.string()).optional(),
  groups: z.array(z.string()).optional(),
  appRoles: z.array(z.string()).optional(),
  rawClaims: z.record(z.string(), z.unknown()).optional(),
  authContext: ssoAuthContextSchema.optional(),
});
export type SsoUserInfo = z.infer<typeof ssoUserInfoSchema>;

export const ssoGroupSchema = z.object({ id: z.string(), name: z.string() });
export type SsoGroup = z.infer<typeof ssoGroupSchema>;

export const ssoTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  idToken: z.string().optional(),
  /** Space-separated scopes actually granted by the IdP (`scope` in the token
   *  response). Persisted on the account row for diagnostics. File import does
   *  not use the SSO token — Knowledge cloud-import OAuth owns that grant. */
  scope: z.string().optional(),
});
export type SsoTokens = z.infer<typeof ssoTokensSchema>;

export const ssoProviderCapabilitiesSchema = z.object({
  supportsGroupSync: z.boolean(),
  supportsRoleMapping: z.boolean(),
  supportsOneDriveAccess: z.boolean(),
  supportsGoogleDriveAccess: z.boolean(),
  supportsPkce: z.boolean(),
});
export type SsoProviderCapabilities = z.infer<
  typeof ssoProviderCapabilitiesSchema
>;

/** Concrete sign-in adapter kind (selects the OIDC/OAuth2 implementation). */
const ssoProviderIdSchema = z.enum(['entra-id', 'generic-oidc', 'oauth2']);
export type SsoProviderId = z.infer<typeof ssoProviderIdSchema>;

// ---------------------------------------------------------------------------
// Claim / attribute mappings (OIDC userinfo claims, SAML assertion attributes)
// ---------------------------------------------------------------------------

export const attributeMappingSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  groups: z.string().optional(),
});
export type AttributeMapping = z.infer<typeof attributeMappingSchema>;

// ---------------------------------------------------------------------------
// Read-facing connection view (NO secrets). Every secret — `clientId`,
// `clientSecret`, `spPrivateKey`, `scimToken` — lives in the on-disk
// `connection.secrets.json` sidecar and is never part of this view; the edit
// form reveals the stored `clientId` on demand via a dedicated action.
// ---------------------------------------------------------------------------

const oidcConfigViewSchema = z.object({
  providerId: ssoProviderIdSchema,
  issuer: z.string(),
  /** Explicit endpoints (OAuth2 / discovery override); surfaced so the edit
   *  form can round-trip an OAuth2 connection. */
  authorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  userinfoEndpoint: z.string().optional(),
  scopes: z.array(z.string()),
  pkce: z.boolean().optional(),
  domainHint: z.string().optional(),
  claimMappings: attributeMappingSchema.optional(),
  /** @deprecated Ignored. File import uses Knowledge cloud-import OAuth, not SSO. */
  enableOneDriveAccess: z.boolean().optional(),
});
type OidcConfigView = z.infer<typeof oidcConfigViewSchema>;

const samlConfigViewSchema = z.object({
  idpEntityId: z.string(),
  idpSsoUrl: z.string(),
  /** PEM signing certificate; safe to show (public). */
  idpCertificate: z.string(),
  wantAssertionsSigned: z.boolean().optional(),
  wantAssertionsEncrypted: z.boolean().optional(),
  /** Whether an SP keypair has been configured (private key is never returned). */
  hasSpKeypair: z.boolean(),
  spCertificate: z.string().optional(),
  attributeMappings: attributeMappingSchema.optional(),
});
type SamlConfigView = z.infer<typeof samlConfigViewSchema>;

const provisioningViewSchema = z.object({
  autoProvisionRole: z.boolean(),
  defaultRole: platformRoleSchema,
  roleMappingRules: z.array(roleMappingRuleSchema),
  autoProvisionTeam: z.boolean(),
  excludeGroups: z.array(z.string()),
});
type ProvisioningView = z.infer<typeof provisioningViewSchema>;

const scimViewSchema = z.object({
  enabled: z.boolean(),
  tokenPrefix: z.string().nullable(),
  tokenGeneratedAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  /** Public SCIM base URL to paste into the IdP. */
  baseUrl: z.string().nullable(),
});
type ScimView = z.infer<typeof scimViewSchema>;

export const ssoConnectionViewSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  protocol: ssoProtocolSchema.nullable(),
  displayName: z.string().nullable(),
  /** @deprecated No longer used for login routing; kept for existing configs. */
  domain: z.string().nullable(),
  oidc: oidcConfigViewSchema.nullable(),
  saml: samlConfigViewSchema.nullable(),
  provisioning: provisioningViewSchema,
  scim: scimViewSchema,
  /** Public endpoints to paste into the IdP. */
  samlSpMetadataUrl: z.string().nullable(),
  samlAcsUrl: z.string().nullable(),
  oidcCallbackUrl: z.string().nullable(),
  /** Deployment env prerequisites the admin form warns on (server-read). */
  deployment: z
    .object({
      siteUrlSet: z.boolean(),
      basePathSet: z.boolean(),
      authSecretSet: z.boolean(),
    })
    .optional(),
  /** @deprecated Multi-org sign-in now uses the org picker; kept for API compat. */
  otherOrgsEnabled: z.boolean().optional(),
});
export type SsoConnectionView = z.infer<typeof ssoConnectionViewSchema>;

// ---------------------------------------------------------------------------
// On-disk file shapes (the SOURCE OF TRUTH).
//
// The connection's editable configuration lives in per-org JSON files — like
// every other config domain (governance, branding, providers):
//   <orgSlug>/governance/sso/connection.json          (non-secret config)
//   <orgSlug>/governance/sso/connection.secrets.json  (plaintext secrets)
// The non-secret half is mirrored into the `configCache` table (domain `sso`,
// key `connection`) so V8 queries/mutations/auth-hooks can read it without
// touching the filesystem. Secrets are read only by the `'use node'` sign-in
// adapters, straight from the sidecar (the filesystem is the trust boundary,
// same model as `providers/*.secrets.json`). SCIM token state is NOT config —
// it stays in the `ssoConnections` DB row (it needs reverse lookup by hash).
// ---------------------------------------------------------------------------

const oidcFileConfigSchema = z.object({
  providerId: ssoProviderIdSchema,
  issuer: z.string(),
  authorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  userinfoEndpoint: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  pkce: z.boolean().optional(),
  domainHint: z.string().optional(),
  claimMappings: attributeMappingSchema.optional(),
  /** @deprecated Ignored. File import uses Knowledge cloud-import OAuth, not SSO. */
  enableOneDriveAccess: z.boolean().optional(),
});
type OidcFileConfig = z.infer<typeof oidcFileConfigSchema>;

const samlFileConfigSchema = z.object({
  idpEntityId: z.string(),
  idpSsoUrl: z.string(),
  idpCertificate: z.string(),
  /** Public SP certificate (the matching private key lives in the secrets file). */
  spCertificate: z.string().optional(),
  wantAssertionsSigned: z.boolean().optional(),
  wantAssertionsEncrypted: z.boolean().optional(),
  attributeMappings: attributeMappingSchema.optional(),
});
type SamlFileConfig = z.infer<typeof samlFileConfigSchema>;

export const provisioningPolicySchema = z.object({
  autoProvisionRole: z.boolean().default(false),
  defaultRole: platformRoleSchema.default('member'),
  roleMappingRules: z.array(roleMappingRuleSchema).default([]),
  autoProvisionTeam: z.boolean().default(false),
  excludeGroups: z.array(z.string()).default([]),
});
export type ProvisioningPolicy = z.infer<typeof provisioningPolicySchema>;

/** `connection.json` — the org's unified SSO connection, sans secrets. */
export const ssoConnectionFileSchema = z.object({
  /** Sign-in (SSO) enabled. SCIM enablement is tracked separately in the DB. */
  enabled: z.boolean().default(false),
  /** Set once a sign-in protocol is configured. */
  protocol: ssoProtocolSchema.optional(),
  displayName: z.string().default('Enterprise SSO'),
  /** @deprecated No longer used for login routing; kept for existing connection.json files. */
  domain: z.string().optional(),
  oidc: oidcFileConfigSchema.optional(),
  saml: samlFileConfigSchema.optional(),
  provisioning: provisioningPolicySchema.default(() =>
    provisioningPolicySchema.parse({}),
  ),
});
export type SsoConnectionFile = z.infer<typeof ssoConnectionFileSchema>;

/** `connection.secrets.json` — plaintext secrets (gitignored sidecar). */
export const ssoConnectionSecretsSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  spPrivateKey: z.string().optional(),
});
export type SsoConnectionSecrets = z.infer<typeof ssoConnectionSecretsSchema>;

/** Effective, defaulted connection used when the org has no `connection.json`. */
function emptySsoConnectionFile(): SsoConnectionFile {
  return ssoConnectionFileSchema.parse({});
}

/**
 * `configCache` coordinates for the connection — V8-safe constants so queries /
 * mutations / auth-hooks can read the file-derived mirror. The `'use node'`
 * `enterprise_sso/file_utils.ts` re-exports these for the file paths.
 */
export const SSO_CONFIG_DOMAIN = 'sso';
export const SSO_CONNECTION_KEY = 'connection';
