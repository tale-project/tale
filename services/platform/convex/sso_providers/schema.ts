import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const platformRoleValidator = v.union(
	v.literal('admin'),
	v.literal('developer'),
	v.literal('editor'),
	v.literal('member'),
	v.literal('disabled'),
);

const roleMappingSourceValidator = v.union(
	v.literal('jobTitle'),
	v.literal('appRole'),
	v.literal('group'),
	v.literal('claim'),
);

const roleMappingRuleValidator = v.object({
	source: roleMappingSourceValidator,
	pattern: v.string(),
	targetRole: platformRoleValidator,
});

const entraIdFeaturesValidator = v.object({
	enableOneDriveAccess: v.optional(v.boolean()),
	autoProvisionTeam: v.optional(v.boolean()),
	excludeGroups: v.optional(v.array(v.string())),
});

const googleWorkspaceFeaturesValidator = v.object({
	enableGoogleDriveAccess: v.optional(v.boolean()),
});

const providerFeaturesValidator = v.object({
	entraId: v.optional(entraIdFeaturesValidator),
	googleWorkspace: v.optional(googleWorkspaceFeaturesValidator),
});

export const ssoProvidersTable = defineTable({
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
})
	.index('organizationId', ['organizationId'])
	.index('providerId', ['providerId']);
