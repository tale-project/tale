import { GenericActionCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { getAdapter } from './registry';
import { syncTeamsFromGroups } from './entra_id/team_sync';
import type { PlatformRole, SsoUserInfo } from './types';

type HandleSsoLoginArgs = {
	email: string;
	name: string;
	externalId: string;
	providerId: string;
	jobTitle?: string;
	appRoles?: string[];
	accessToken: string;
	refreshToken?: string;
	accessTokenExpiresAt?: number;
	organizationId: string;
};

type HandleSsoLoginResult = {
	success: boolean;
	error?: string;
	sessionToken?: string;
	userId?: string;
};

export async function handleSsoLogin(
	ctx: GenericActionCtx<DataModel>,
	args: HandleSsoLoginArgs,
): Promise<HandleSsoLoginResult> {
	try {
		const ssoConfig = await ctx.runQuery(internal.sso_providers.internal_queries.getSsoConfig, {});

		const adapter = getAdapter(args.providerId);
		if (!adapter) {
			return { success: false, error: `Unsupported SSO provider: ${args.providerId}` };
		}

		let role: PlatformRole = 'member';
		if (ssoConfig?.autoProvisionRole && adapter.mapToRole) {
			const userInfo: SsoUserInfo = {
				externalId: args.externalId,
				email: args.email,
				name: args.name,
				jobTitle: args.jobTitle,
				appRoles: args.appRoles,
			};
			role = adapter.mapToRole(ssoConfig.roleMappingRules, ssoConfig.defaultRole, userInfo);
		}

		const result = await ctx.runMutation(internal.sso_providers.internal_mutations.findOrCreateSsoUser, {
			email: args.email.toLowerCase(),
			name: args.name,
			externalId: args.externalId,
			providerId: args.providerId,
			accessToken: args.accessToken,
			refreshToken: args.refreshToken,
			accessTokenExpiresAt: args.accessTokenExpiresAt,
			organizationId: args.organizationId,
			role,
		});

		if (!result.userId) {
			return { success: false, error: 'Failed to create or find user' };
		}

		const entraFeatures = ssoConfig?.providerFeatures?.entraId;
		if (entraFeatures?.autoProvisionTeam && adapter.getGroups) {
			try {
				const syncResult = await syncTeamsFromGroups({
					ctx: ctx as any,
					userId: result.userId,
					accessToken: args.accessToken,
					excludeGroups: entraFeatures.excludeGroups || [],
					adapter,
				});

				if (syncResult.errors.length > 0) {
					console.warn('[SSO] Team sync errors:', syncResult.errors);
				}
			} catch (syncError) {
				console.error('[SSO] Team sync failed:', syncError);
			}
		}

		const sessionResult = await ctx.runMutation(internal.sso_providers.internal_mutations.createUserSession, {
			userId: result.userId,
			organizationId: args.organizationId,
		});

		return {
			success: true,
			userId: result.userId ?? undefined,
			sessionToken: sessionResult.sessionToken ?? undefined,
		};
	} catch (error) {
		console.error('[SSO] handleSsoLogin error:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}
