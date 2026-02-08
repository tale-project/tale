import { GenericQueryCtx } from 'convex/server';
import { DataModel, Id } from '../_generated/dataModel';
import { components } from '../_generated/api';
import { getAuthUserIdentity } from '../lib/rls';
import type { PlatformRole, ProviderFeatures, RoleMappingRule } from '@/lib/shared/schemas/sso_providers';

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
	const authUser = await getAuthUserIdentity(ctx);
	if (!authUser) {
		return null;
	}

	const sessionResult = await ctx.runQuery(
		components.betterAuth.adapter.findMany,
		{
			model: 'session',
			paginationOpts: { cursor: null, numItems: 1 },
			where: [{ field: 'userId', value: authUser.userId, operator: 'eq' }],
		},
	);

	let organizationId: string | null = null;
	if (sessionResult?.page?.[0]?.activeOrganizationId) {
		organizationId = sessionResult.page[0].activeOrganizationId;
	} else {
		const memberResult = await ctx.runQuery(
			components.betterAuth.adapter.findMany,
			{
				model: 'member',
				paginationOpts: { cursor: null, numItems: 1 },
				where: [{ field: 'userId', value: authUser.userId, operator: 'eq' }],
			},
		);
		organizationId = memberResult?.page?.[0]?.organizationId ? String(memberResult.page[0].organizationId) : null;
	}

	if (!organizationId) {
		return null;
	}

	const provider = await ctx.db
		.query('ssoProviders')
		.withIndex('organizationId', (q) => q.eq('organizationId', organizationId))
		.first();

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
