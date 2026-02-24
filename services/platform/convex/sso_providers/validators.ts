import { v } from 'convex/values';

import { memberRoleValidator } from '../members/validators';

export const platformRoleValidator = memberRoleValidator;

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
});

export const entraIdFeaturesValidator = v.object({
  enableOneDriveAccess: v.optional(v.boolean()),
  autoProvisionTeam: v.optional(v.boolean()),
  excludeGroups: v.optional(v.array(v.string())),
});

export const googleWorkspaceFeaturesValidator = v.object({
  enableGoogleDriveAccess: v.optional(v.boolean()),
});

export const providerFeaturesValidator = v.object({
  entraId: v.optional(entraIdFeaturesValidator),
  googleWorkspace: v.optional(googleWorkspaceFeaturesValidator),
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
