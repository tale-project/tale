import { z } from 'zod/v4';

const ssoProviderIdLiterals = [
  'entra-id',
  'google-workspace',
  'okta',
  'generic-oidc',
] as const;
const ssoProviderIdSchema = z.enum(ssoProviderIdLiterals);
type SsoProviderId = z.infer<typeof ssoProviderIdSchema>;

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
type RoleMappingSource = z.infer<typeof roleMappingSourceSchema>;

export const roleMappingRuleSchema = z.object({
  source: roleMappingSourceSchema,
  pattern: z.string(),
  targetRole: platformRoleSchema,
});
export type RoleMappingRule = z.infer<typeof roleMappingRuleSchema>;

export const ssoProviderCapabilitiesSchema = z.object({
  supportsGroupSync: z.boolean(),
  supportsRoleMapping: z.boolean(),
  supportsOneDriveAccess: z.boolean(),
  supportsGoogleDriveAccess: z.boolean(),
});
export type SsoProviderCapabilities = z.infer<
  typeof ssoProviderCapabilitiesSchema
>;

export const ssoUserInfoSchema = z.object({
  externalId: z.string(),
  email: z.string(),
  name: z.string(),
  jobTitle: z.string().optional(),
  groups: z.array(z.string()).optional(),
  appRoles: z.array(z.string()).optional(),
  rawClaims: z.record(z.string(), z.unknown()).optional(),
});
export type SsoUserInfo = z.infer<typeof ssoUserInfoSchema>;

export const ssoTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  idToken: z.string().optional(),
});
export type SsoTokens = z.infer<typeof ssoTokensSchema>;

export const ssoGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type SsoGroup = z.infer<typeof ssoGroupSchema>;

const entraIdFeaturesSchema = z.object({
  enableOneDriveAccess: z.boolean().optional(),
  autoProvisionTeam: z.boolean().optional(),
  excludeGroups: z.array(z.string()).optional(),
});
type EntraIdFeatures = z.infer<typeof entraIdFeaturesSchema>;

const googleWorkspaceFeaturesSchema = z.object({
  enableGoogleDriveAccess: z.boolean().optional(),
});
type GoogleWorkspaceFeatures = z.infer<typeof googleWorkspaceFeaturesSchema>;

export const providerFeaturesSchema = z.object({
  entraId: entraIdFeaturesSchema.optional(),
  googleWorkspace: googleWorkspaceFeaturesSchema.optional(),
});
export type ProviderFeatures = z.infer<typeof providerFeaturesSchema>;

export const ssoProviderSchema = z.object({
  _id: z.string(),
  providerId: z.string(),
  issuer: z.string(),
  clientId: z.string().optional(),
  scopes: z.array(z.string()),
  autoProvisionRole: z.boolean(),
  roleMappingRules: z.array(roleMappingRuleSchema),
  defaultRole: platformRoleSchema,
  providerFeatures: providerFeaturesSchema.optional(),
});
export type SsoProvider = z.infer<typeof ssoProviderSchema>;
