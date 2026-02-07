import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { authComponent } from '../auth';

export type TokenResult =
  | { success: true; token: string; userId: string }
  | { success: false; error: string };

export async function withMicrosoftToken(ctx: ActionCtx): Promise<TokenResult> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return { success: false, error: 'Unauthenticated' };
  }

  const userId = String(authUser._id);

  const tokenResult = await ctx.runQuery(
    internal.onedrive.internal_queries.getUserToken,
    { userId },
  );

  if (tokenResult.needsRefresh && tokenResult.accountId && tokenResult.refreshToken) {
    const refreshResult = await ctx.runAction(internal.onedrive.internal_actions.refreshToken, {
      accountId: tokenResult.accountId,
      refreshToken: tokenResult.refreshToken,
    });

    if (!refreshResult.success) {
      return { success: false, error: refreshResult.error || 'Failed to refresh OneDrive token' };
    }

    const newTokenResult = await ctx.runQuery(
      internal.onedrive.internal_queries.getUserToken,
      { userId },
    );

    if (!newTokenResult.token) {
      return { success: false, error: 'Failed to retrieve refreshed OneDrive token' };
    }

    return { success: true, token: newTokenResult.token, userId };
  }

  if (!tokenResult.token) {
    return { success: false, error: 'Microsoft account not connected or token expired' };
  }

  return { success: true, token: tokenResult.token, userId };
}
