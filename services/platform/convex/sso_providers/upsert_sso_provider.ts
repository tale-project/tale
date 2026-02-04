import { GenericActionCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { validateSsoConfig } from './validate_sso_config';
import type { PlatformRole, RoleMappingRule } from './types';

type EntraIdFeatures = {
	enableOneDriveAccess?: boolean;
	autoProvisionTeam?: boolean;
	excludeGroups?: string[];
};

type GoogleWorkspaceFeatures = {
	enableGoogleDriveAccess?: boolean;
};

type ProviderFeatures = {
	entraId?: EntraIdFeatures;
	googleWorkspace?: GoogleWorkspaceFeatures;
};

type UpsertSsoProviderArgs = {
	organizationId: string;
	providerId: string;
	issuer: string;
	clientId: string;
	clientSecret?: string;
	scopes: string[];
	autoProvisionRole: boolean;
	roleMappingRules: RoleMappingRule[];
	defaultRole: PlatformRole;
	providerFeatures?: ProviderFeatures;
};

export async function upsertSsoProvider(ctx: GenericActionCtx<DataModel>, args: UpsertSsoProviderArgs): Promise<string> {
	const authUser: { _id: string; email: string; name: string } | null = await ctx.runQuery(
		internal.sso_providers.internal_queries.getAuthUser,
		{},
	);
	if (!authUser) {
		throw new Error('Unauthenticated');
	}

	const callerRole: string | null = await ctx.runQuery(internal.sso_providers.internal_queries.getCallerRole, {
		organizationId: args.organizationId,
		userId: authUser._id,
	});

	if (callerRole !== 'admin') {
		throw new Error('Only Admins can configure SSO providers');
	}

	const existingProvider = await ctx.runQuery(internal.sso_providers.internal_queries.getByOrganization, {
		organizationId: args.organizationId,
	});

	let clientIdEncrypted: string;
	let clientSecretEncrypted: string;

	if (args.clientSecret) {
		const validation = await validateSsoConfig({
			issuer: args.issuer,
			clientId: args.clientId,
			clientSecret: args.clientSecret,
		});

		if (!validation.valid) {
			throw new Error(validation.error || 'Invalid SSO configuration');
		}

		clientIdEncrypted = await ctx.runAction(internal.lib.crypto.actions.encryptStringInternal, {
			plaintext: args.clientId,
		});

		clientSecretEncrypted = await ctx.runAction(internal.lib.crypto.actions.encryptStringInternal, {
			plaintext: args.clientSecret,
		});
	} else if (existingProvider) {
		clientIdEncrypted = existingProvider.clientIdEncrypted;
		clientSecretEncrypted = existingProvider.clientSecretEncrypted;
	} else {
		throw new Error('Client secret is required for new SSO configuration');
	}

	const providerId: string = await ctx.runMutation(internal.sso_providers.internal_mutations.upsertProvider, {
		organizationId: args.organizationId,
		providerId: args.providerId,
		issuer: args.issuer,
		clientIdEncrypted,
		clientSecretEncrypted,
		scopes: args.scopes,
		autoProvisionRole: args.autoProvisionRole,
		roleMappingRules: args.roleMappingRules,
		defaultRole: args.defaultRole,
		providerFeatures: args.providerFeatures,
		actorId: authUser._id,
		actorEmail: authUser.email,
		actorRole: callerRole,
	});

	return providerId;
}
