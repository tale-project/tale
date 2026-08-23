import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { authComponent } from '../auth';

export type TokenResult =
  | { success: true; token: string; userId: string }
  | { success: false; error: string };

/**
 * Resolve a Google Drive access token for Knowledge import.
 * Grant-only — no login-linked Google shortcut.
 */
export async function withGoogleToken(
  ctx: ActionCtx,
  organizationId: string,
): Promise<TokenResult> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    return { success: false, error: 'Unauthenticated' };
  }

  const userId = String(authUser._id);
  const cloud = await ctx.runAction(
    internal.cloud_import.resolve_token.resolveAccessToken,
    {
      organizationId,
      userId,
      provider: 'google-drive',
    },
  );
  if (cloud.success) {
    return { success: true, token: cloud.accessToken, userId };
  }

  return {
    success: false,
    error:
      'Google Drive is not authorized for importing. Connect Google Drive from Documents.',
  };
}
