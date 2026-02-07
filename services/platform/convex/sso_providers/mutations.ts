import { v } from 'convex/values';
import { action } from '../_generated/server';
import { internal } from '../_generated/api';
import { upsertSsoProvider } from './upsert_sso_provider';
import { removeSsoProvider } from './remove_sso_provider';
import { validateSsoConfig } from './validate_sso_config';
import { decryptString } from '../lib/crypto/decrypt_string';
import {
	platformRoleValidator,
	roleMappingRuleValidator,
	providerFeaturesValidator,
} from './validators';

const ssoProviderInputValidator = v.object({
	organizationId: v.string(),
	providerId: v.string(),
	issuer: v.string(),
	clientId: v.string(),
	clientSecret: v.optional(v.string()),
	scopes: v.array(v.string()),
	autoProvisionRole: v.boolean(),
	roleMappingRules: v.array(roleMappingRuleValidator),
	defaultRole: platformRoleValidator,
	providerFeatures: v.optional(providerFeaturesValidator),
});

export const upsert = action({
	args: ssoProviderInputValidator,
	returns: v.string(),
	handler: async (ctx, args) => upsertSsoProvider(ctx, args),
});

export const remove = action({
	args: {
		organizationId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => removeSsoProvider(ctx, args),
});

export const testConfig = action({
	args: {
		issuer: v.string(),
		clientId: v.string(),
		clientSecret: v.string(),
	},
	returns: v.object({
		valid: v.boolean(),
		error: v.optional(v.string()),
	}),
	handler: async (ctx, args) => {
		const authUser: { _id: string } | null = await ctx.runQuery(
			internal.sso_providers.internal_queries.getAuthUser,
			{},
		);

		if (!authUser) {
			return { valid: false, error: 'Unauthenticated' };
		}

		const result = await validateSsoConfig(args);
		return {
			valid: result.valid,
			error: result.error,
		};
	},
});

export const testExistingConfig = action({
	args: {},
	returns: v.object({
		valid: v.boolean(),
		error: v.optional(v.string()),
	}),
	handler: async (ctx) => {
		const authUser: { _id: string } | null = await ctx.runQuery(
			internal.sso_providers.internal_queries.getAuthUser,
			{},
		);

		if (!authUser) {
			return { valid: false, error: 'Not authenticated' };
		}

		const provider = await ctx.runQuery(internal.sso_providers.internal_queries.getSsoConfig, {});

		if (!provider) {
			return { valid: false, error: 'No SSO configuration found' };
		}

		const clientId = await decryptString(provider.clientIdEncrypted);
		const clientSecret = await decryptString(provider.clientSecretEncrypted);

		const result = await validateSsoConfig({
			issuer: provider.issuer,
			clientId,
			clientSecret,
		});

		return {
			valid: result.valid,
			error: result.error,
		};
	},
});
