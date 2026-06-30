import type { GenericActionCtx } from 'convex/server';

import { internal } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import { mapEntraRoleToPlatformRole } from './entra_id/role_mapping';
import {
  syncTeamsFromGroupNames,
  type SyncTeamsFromGroupsArgs,
} from './entra_id/team_sync';
import type { PlatformRole, SsoUserInfo } from './types';

type HandleSsoLoginArgs = {
  email: string;
  name: string;
  externalId: string;
  providerId: string;
  jobTitle?: string;
  appRoles?: string[];
  groups?: string[];
  rawClaims?: Record<string, unknown>;
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

/**
 * Shared sign-in provisioning: maps the IdP identity to a platform role, finds
 * or creates the user + org membership, optionally syncs IdP groups to teams,
 * and mints a session. Reached by every protocol (OIDC/OAuth2 callback, SAML
 * ACS) after they normalize the IdP response into these args.
 */
export async function handleSsoLogin(
  ctx: GenericActionCtx<DataModel>,
  args: HandleSsoLoginArgs,
): Promise<HandleSsoLoginResult> {
  try {
    // Protocol-agnostic provisioning policy — the unification point shared by
    // OIDC, OAuth2, and SAML (role mapping + group→team sync run identically).
    const config = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveProvisioning,
      { organizationId: args.organizationId },
    );

    let role: PlatformRole = config.defaultRole;
    if (config.autoProvisionRole) {
      const userInfo: SsoUserInfo = {
        externalId: args.externalId,
        email: args.email,
        name: args.name,
        jobTitle: args.jobTitle,
        appRoles: args.appRoles,
        groups: args.groups,
        rawClaims: args.rawClaims,
      };
      role = mapEntraRoleToPlatformRole(
        config.roleMappingRules,
        config.defaultRole,
        userInfo,
      );
    }

    const result = await ctx.runMutation(
      internal.enterprise_sso.internal_mutations.findOrCreateSsoUser,
      {
        email: args.email.toLowerCase(),
        name: args.name,
        externalId: args.externalId,
        providerId: args.providerId,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        organizationId: args.organizationId,
        role,
        // IdP is authoritative for roles when auto-assign is on — keep an
        // existing member's role in sync on every login, not just at creation.
        syncRole: config.autoProvisionRole,
      },
    );

    if (!result.userId) {
      return { success: false, error: 'Failed to create or find user' };
    }

    if (config.autoProvisionTeam && args.groups?.length) {
      try {
        const syncResult = await syncTeamsFromGroupNames({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- GenericActionCtx shares the runQuery/runMutation surface with MutationCtx
          ctx: ctx as unknown as SyncTeamsFromGroupsArgs['ctx'],
          userId: result.userId,
          organizationId: args.organizationId,
          groupNames: args.groups,
          excludeGroups: config.excludeGroups,
        });
        if (syncResult.errors.length > 0) {
          console.warn('[SSO] Team sync errors:', syncResult.errors);
        }
      } catch (syncError) {
        console.error('[SSO] Team sync failed:', syncError);
      }
    }

    const sessionResult = await ctx.runMutation(
      internal.enterprise_sso.internal_mutations.createUserSession,
      { userId: result.userId, organizationId: args.organizationId },
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
