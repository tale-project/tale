/**
 * Get User Token Logic - Business logic for getting Microsoft Graph token
 */

import type { QueryCtx } from '../../_generated/server';
import * as MicrosoftAccountsModel from '../accounts/microsoft';

export interface GetUserTokenResult {
  token: string | null;
  needsRefresh: boolean;
  accountId?: string;
  refreshToken?: string;
}

/**
 * Get Microsoft Graph token for a specific user
 * Checks token validity and returns account info if refresh is needed
 */
export async function getUserTokenLogic(
  ctx: QueryCtx,
  args: { userId: string },
): Promise<GetUserTokenResult> {
  const account = await MicrosoftAccountsModel.getMicrosoftAccountByUserId(
    ctx,
    args.userId,
  );

  if (!account) {
    return { token: null, needsRefresh: false };
  }

  // No access token available
  if (!account.accessToken) {
    // If we have a usable refresh token, request a refresh
    const hasUsableRefresh =
      !!account.refreshToken &&
      (!account.refreshTokenExpiresAt ||
        account.refreshTokenExpiresAt > Date.now());

    if (hasUsableRefresh) {
      console.warn(
        `getUserTokenLogic: No access token for user ${args.userId}, will refresh using refresh token`,
      );
      return {
        token: null,
        needsRefresh: true,
        accountId: account.accountId,
        refreshToken: account.refreshToken ?? undefined,
      };
    }

    // No access or refresh token; nothing we can do
    return { token: null, needsRefresh: false };
  }

  // Access token exists; check expiry with buffer
  if (account.accessTokenExpiresAt) {
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
    if (account.accessTokenExpiresAt < now + bufferMs) {
      if (account.refreshToken) {
        // Token is expired or about to expire - needs refresh
        console.warn(
          `getUserTokenLogic: Token expired for user ${args.userId}, needs refresh`,
        );
        return {
          token: null,
          needsRefresh: true,
          accountId: account.accountId,
          refreshToken: account.refreshToken ?? undefined,
        };
      } else {
        // Token expiring but no refresh token; treat as invalid
        return { token: null, needsRefresh: false };
      }
    }
  }

  return { token: account.accessToken, needsRefresh: false };
}
