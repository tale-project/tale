import { v } from 'convex/values';
import { query, action } from '../_generated/server';
import { get as getFn } from './get';
import { isSsoConfigured as isSsoConfiguredFn } from './is_sso_configured';
import { getMicrosoftToken as getMicrosoftTokenFn } from './get_microsoft_token';
import { getWithClientId as getWithClientIdFn } from './get_with_client_id';
import { getSsoCredentialsForEmail as getSsoCredentialsForEmailFn } from './get_sso_credentials_for_email';

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

export const get = query({
	args: {},
	returns: v.union(
		v.object({
			_id: v.id('ssoProviders'),
			organizationId: v.string(),
			providerId: v.string(),
			issuer: v.string(),
			scopes: v.array(v.string()),
			autoProvisionRole: v.boolean(),
			roleMappingRules: v.array(roleMappingRuleValidator),
			defaultRole: platformRoleValidator,
			providerFeatures: v.optional(providerFeaturesValidator),
			createdAt: v.number(),
			updatedAt: v.number(),
		}),
		v.null(),
	),
	handler: async (ctx) => getFn(ctx),
});

export const isSsoConfigured = query({
	args: {},
	returns: v.object({
		enabled: v.boolean(),
		providerType: v.optional(v.string()),
	}),
	handler: async (ctx) => isSsoConfiguredFn(ctx),
});

export const getMicrosoftToken = query({
	args: {},
	returns: v.union(
		v.object({
			accessToken: v.union(v.string(), v.null()),
			refreshToken: v.union(v.string(), v.null()),
			expiresAt: v.union(v.number(), v.null()),
			isExpired: v.boolean(),
		}),
		v.null(),
	),
	handler: async (ctx) => getMicrosoftTokenFn(ctx),
});

export const getWithClientId = action({
	args: {},
	returns: v.union(
		v.object({
			_id: v.id('ssoProviders'),
			organizationId: v.string(),
			providerId: v.string(),
			issuer: v.string(),
			clientId: v.string(),
			scopes: v.array(v.string()),
			autoProvisionRole: v.boolean(),
			roleMappingRules: v.array(roleMappingRuleValidator),
			defaultRole: platformRoleValidator,
			providerFeatures: v.optional(providerFeaturesValidator),
			createdAt: v.number(),
			updatedAt: v.number(),
		}),
		v.null(),
	),
	handler: async (ctx) => getWithClientIdFn(ctx),
});

export const getSsoCredentialsForEmail = action({
	args: {
		organizationId: v.string(),
	},
	returns: v.union(
		v.object({
			clientId: v.string(),
			clientSecret: v.string(),
			tenantId: v.string(),
		}),
		v.null(),
	),
	handler: async (ctx, args) => getSsoCredentialsForEmailFn(ctx, args),
});
