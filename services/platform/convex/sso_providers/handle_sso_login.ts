import { GenericActionCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { syncTeamsFromGroups } from '../betterAuth/entra_team_sync/sync_teams_from_groups';
import { mapEntraRoleToPlatformRole } from '../betterAuth/entra_team_sync/map_entra_role_to_platform_role';

type HandleSsoLoginArgs = {
  email: string;
  name: string;
  microsoftId: string;
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

    // Determine the role to assign
    let role: 'admin' | 'developer' | 'editor' | 'member' | 'disabled' = 'member';
    if (ssoConfig?.autoProvisionRole) {
      role = mapEntraRoleToPlatformRole(
        ssoConfig.roleMappingRules,
        ssoConfig.defaultRole,
        args.jobTitle,
        args.appRoles,
      );
    }

    const result = await ctx.runMutation(
      internal.sso_providers.internal_mutations.findOrCreateSsoUser,
      {
        email: args.email.toLowerCase(),
        name: args.name,
        microsoftId: args.microsoftId,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        organizationId: args.organizationId,
        role,
      },
    );

    if (!result.userId) {
      return { success: false, error: 'Failed to create or find user' };
    }

    // Sync teams from Entra groups if enabled
    if (ssoConfig?.autoProvisionTeam) {
      try {
        const syncResult = await syncTeamsFromGroups({
          ctx: ctx as any,
          userId: result.userId,
          accessToken: args.accessToken,
          excludeGroups: ssoConfig.excludeGroups,
        });

        if (syncResult.errors.length > 0) {
          console.warn('[SSO] Team sync errors:', syncResult.errors);
        }
      } catch (syncError) {
        console.error('[SSO] Team sync failed:', syncError);
      }
    }

    const sessionResult = await ctx.runMutation(
      internal.sso_providers.internal_mutations.createUserSession,
      {
        userId: result.userId,
        organizationId: args.organizationId,
      },
    );

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
