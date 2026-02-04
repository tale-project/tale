import { GenericActionCtx } from 'convex/server';
import { DataModel, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { decryptString } from '../lib/crypto/decrypt_string';
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

type GetWithClientIdResult = {
	_id: Id<'ssoProviders'>;
	organizationId: string;
	providerId: string;
	issuer: string;
	clientId: string;
	scopes: string[];
	autoProvisionRole: boolean;
	roleMappingRules: RoleMappingRule[];
	defaultRole: PlatformRole;
	providerFeatures?: ProviderFeatures;
	createdAt: number;
	updatedAt: number;
} | null;

export async function getWithClientId(ctx: GenericActionCtx<DataModel>): Promise<GetWithClientIdResult> {
	const authUser: { _id: string } | null = await ctx.runQuery(internal.sso_providers.internal_queries.getAuthUser, {});

	if (!authUser) {
		return null;
	}

	const provider = await ctx.runQuery(internal.sso_providers.internal_queries.getSsoConfig, {});

	if (!provider) {
		return null;
	}

	let clientId: string;
	try {
		clientId = await decryptString(provider.clientIdEncrypted);
	} catch (error) {
		console.error('[SSO] Failed to decrypt clientId for provider:', provider._id, error);
		return null;
	}

	return {
		_id: provider._id,
		organizationId: provider.organizationId,
		providerId: provider.providerId,
		issuer: provider.issuer,
		clientId,
		scopes: provider.scopes,
		autoProvisionRole: provider.autoProvisionRole,
		roleMappingRules: provider.roleMappingRules,
		defaultRole: provider.defaultRole,
		providerFeatures: provider.providerFeatures,
		createdAt: provider.createdAt,
		updatedAt: provider.updatedAt,
	};
}
