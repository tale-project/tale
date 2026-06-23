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
// Read-facing connection view (NO secrets). `clientId` is shown for editing;
// `clientSecret`/`spPrivateKey`/`scimToken` are write-only and never returned.
// ---------------------------------------------------------------------------

const oidcConfigViewSchema = z.object({
  providerId: ssoProviderIdSchema,
  issuer: z.string(),
  scopes: z.array(z.string()),
  pkce: z.boolean().optional(),
  domainHint: z.string().optional(),
  claimMappings: attributeMappingSchema.optional(),
  /** Entra/Graph extras (OneDrive scope, etc.). */
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
  domain: z.string().nullable(),
  oidc: oidcConfigViewSchema.nullable(),
  saml: samlConfigViewSchema.nullable(),
  provisioning: provisioningViewSchema,
  scim: scimViewSchema,
  /** Public endpoints to paste into the IdP. */
  samlSpMetadataUrl: z.string().nullable(),
  samlAcsUrl: z.string().nullable(),
  oidcCallbackUrl: z.string().nullable(),
});
export type SsoConnectionView = z.infer<typeof ssoConnectionViewSchema>;
