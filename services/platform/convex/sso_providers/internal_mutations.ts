import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { upsertProvider as upsertProviderFn } from './upsert_provider';
import { removeProvider as removeProviderFn } from './remove_provider';
import { findOrCreateSsoUser as findOrCreateSsoUserFn } from './find_or_create_sso_user';
import { createUserSession as createUserSessionFn } from './create_user_session';
import {
	platformRoleValidator,
	roleMappingRuleValidator,
	providerFeaturesValidator,
} from './validators';

export const upsertProvider = internalMutation({
	args: {
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
		actorId: v.string(),
		actorEmail: v.string(),
		actorRole: v.string(),
	},
	returns: v.string(),
	handler: async (ctx, args) => upsertProviderFn(ctx, args),
});

export const removeProvider = internalMutation({
	args: {
		organizationId: v.string(),
		actorId: v.string(),
		actorEmail: v.string(),
		actorRole: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => removeProviderFn(ctx, args),
});

export const findOrCreateSsoUser = internalMutation({
	args: {
		email: v.string(),
		name: v.string(),
		externalId: v.string(),
		providerId: v.string(),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		accessTokenExpiresAt: v.optional(v.number()),
		organizationId: v.string(),
		role: platformRoleValidator,
	},
	returns: v.object({
		userId: v.union(v.string(), v.null()),
		isNewUser: v.boolean(),
	}),
	handler: async (ctx, args) => findOrCreateSsoUserFn(ctx, args),
});

export const createUserSession = internalMutation({
	args: {
		userId: v.string(),
		organizationId: v.string(),
	},
	returns: v.object({
		sessionToken: v.union(v.string(), v.null()),
		sessionId: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, args) => createUserSessionFn(ctx, args),
});
