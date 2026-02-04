import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const platformRoleValidator = v.union(
  v.literal('admin'),
  v.literal('developer'),
  v.literal('editor'),
  v.literal('member'),
  v.literal('disabled'),
);

const roleMappingRuleValidator = v.object({
  source: v.union(v.literal('jobTitle'), v.literal('appRole')),
  pattern: v.string(),
  targetRole: platformRoleValidator,
});

export const ssoProvidersTable = defineTable({
  organizationId: v.string(),
  providerId: v.string(),
  issuer: v.string(),
  clientIdEncrypted: v.string(),
  clientSecretEncrypted: v.string(),
  scopes: v.array(v.string()),
  // Team provisioning
  autoProvisionTeam: v.boolean(),
  excludeGroups: v.array(v.string()),
  // Role provisioning
  autoProvisionRole: v.boolean(),
  roleMappingRules: v.array(roleMappingRuleValidator),
  defaultRole: platformRoleValidator,
  // OneDrive access
  enableOneDriveAccess: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('organizationId', ['organizationId'])
  .index('providerId', ['providerId']);
