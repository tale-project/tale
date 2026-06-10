import { v } from 'convex/values';

export const platformRoleValidator = v.union(
  v.literal('disabled'),
  v.literal('member'),
  v.literal('editor'),
  v.literal('developer'),
  v.literal('admin'),
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
  // Dot-path into the raw userinfo claims (e.g. `realm_access.roles`);
  // only read when `source` is `claim`.
  claim: v.optional(v.string()),
});

export const entraIdFeaturesValidator = v.object({
  enableOneDriveAccess: v.optional(v.boolean()),
  autoProvisionTeam: v.optional(v.boolean()),
  excludeGroups: v.optional(v.array(v.string())),
  seamlessSsoEnabled: v.optional(v.boolean()),
  domainHint: v.optional(v.string()),
});

export const googleWorkspaceFeaturesValidator = v.object({
  enableGoogleDriveAccess: v.optional(v.boolean()),
});

// Claim names accept dot-paths so nested claims (Keycloak's
// `realm_access.roles`, namespaced Auth0 claims) can be mapped without
// provider-specific code.
const genericOidcFeaturesValidator = v.object({
  emailClaim: v.optional(v.string()),
  nameClaim: v.optional(v.string()),
  groupsClaim: v.optional(v.string()),
  autoProvisionTeam: v.optional(v.boolean()),
  excludeGroups: v.optional(v.array(v.string())),
});

export const providerFeaturesValidator = v.object({
  entraId: v.optional(entraIdFeaturesValidator),
  googleWorkspace: v.optional(googleWorkspaceFeaturesValidator),
  genericOidc: v.optional(genericOidcFeaturesValidator),
});

export const ssoConfigValidator = v.object({
  _id: v.id('ssoProviders'),
  organizationId: v.string(),
  providerId: v.string(),
  issuer: v.string(),
  clientIdEncrypted: v.string(),
  clientSecretEncrypted: v.string(),
  scopes: v.array(v.string()),
  autoProvisionRole: v.boolean(),
  roleMappingRules: v.array(roleMappingRuleValidator),
  defaultRole: platformRoleValidator,
  providerFeatures: v.optional(providerFeaturesValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});
