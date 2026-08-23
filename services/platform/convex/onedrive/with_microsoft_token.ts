import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { authComponent } from '../auth';

export type TokenResult =
  | { success: true; token: string; userId: string }
  | { success: false; error: string };

/**
 * Resolve a Microsoft Graph access token for Knowledge OneDrive/SharePoint.
 *
 * Preference order when `organizationId` is set:
 *   1. Per-user cloud-import authorization (explicit Documents grant)
 *   2. Better Auth Microsoft login account (legacy / SSO shortcut)
 *
 * Without `organizationId`, only the login-linked account is tried (legacy
 * list calls). Agents must not call this helper.
 */
export async function withMicrosoftToken(
  ctx: ActionCtx,
  organizationId?: string,
): Promise<TokenResult> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    return { success: false, error: 'Unauthenticated' };
  }

  const userId = String(authUser._id);

  if (organizationId) {
    const cloud = await ctx.runAction(
      internal.cloud_import.resolve_token.resolveAccessToken,
      {
        organizationId,
        userId,
        provider: 'onedrive',
      },
    );
    if (cloud.success) {
      return { success: true, token: cloud.accessToken, userId };
    }
  }

  const tokenResult = await ctx.runQuery(
    internal.onedrive.internal_queries.getUserToken,
    { userId },
  );

  if (
    tokenResult.needsRefresh &&
    tokenResult.accountId &&
    tokenResult.refreshToken
  ) {
    const refreshResult = await ctx.runAction(
      internal.onedrive.internal_actions.refreshToken,
      {
        accountId: tokenResult.accountId,
        refreshToken: tokenResult.refreshToken,
      },
    );

    if (!refreshResult.success) {
      return {
        success: false,
        error: refreshResult.error || 'Failed to refresh OneDrive token',
      };
    }

    const newTokenResult = await ctx.runQuery(
      internal.onedrive.internal_queries.getUserToken,
      { userId },
    );

    if (!newTokenResult.token) {
      return {
        success: false,
        error: 'Failed to retrieve refreshed OneDrive token',
      };
    }

    return { success: true, token: newTokenResult.token, userId };
  }

  if (!tokenResult.token) {
    return {
      success: false,
      error:
        organizationId !== undefined
          ? 'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.'
          : 'Microsoft account not connected or token expired',
    };
  }

  return { success: true, token: tokenResult.token, userId };
}
