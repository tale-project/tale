import { GenericQueryCtx } from 'convex/server';
import { DataModel, Id } from '../_generated/dataModel';
import { authComponent } from '../auth';
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

type GetResult = {
	_id: Id<'ssoProviders'>;
	organizationId: string;
	providerId: string;
	issuer: string;
	scopes: string[];
	autoProvisionRole: boolean;
	roleMappingRules: RoleMappingRule[];
	defaultRole: PlatformRole;
	providerFeatures?: ProviderFeatures;
	createdAt: number;
	updatedAt: number;
} | null;

export async function get(ctx: GenericQueryCtx<DataModel>): Promise<GetResult> {
	const authUser = await authComponent.getAuthUser(ctx);
	if (!authUser) {
		return null;
	}

	const provider = await ctx.db.query('ssoProviders').first();

	if (!provider) {
		return null;
	}

	return {
		_id: provider._id,
		organizationId: provider.organizationId,
		providerId: provider.providerId,
		issuer: provider.issuer,
		scopes: provider.scopes,
		autoProvisionRole: provider.autoProvisionRole ?? false,
		roleMappingRules: provider.roleMappingRules ?? [],
		defaultRole: provider.defaultRole ?? 'member',
		providerFeatures: provider.providerFeatures,
		createdAt: provider.createdAt,
		updatedAt: provider.updatedAt,
	};
}
