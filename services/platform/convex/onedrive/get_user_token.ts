/**
 * Get User Token - Business logic for getting Microsoft Graph token
 */

import type { QueryCtx } from '../_generated/server';
import * as MicrosoftAccountsModel from '../accounts/helpers';

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
export async function getUserToken(
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

  if (!account.accessToken) {
    const hasUsableRefresh =
      !!account.refreshToken &&
      (!account.refreshTokenExpiresAt ||
        account.refreshTokenExpiresAt > Date.now());

    if (hasUsableRefresh) {
      console.warn(
        `getUserToken: No access token for user ${args.userId}, will refresh using refresh token`,
      );
      return {
        token: null,
        needsRefresh: true,
        accountId: account.accountId,
        refreshToken: account.refreshToken ?? undefined,
      };
    }

    return { token: null, needsRefresh: false };
  }

  if (account.accessTokenExpiresAt) {
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;
    if (account.accessTokenExpiresAt < now + bufferMs) {
      if (account.refreshToken) {
        console.warn(
          `getUserToken: Token expired for user ${args.userId}, needs refresh`,
        );
        return {
          token: null,
          needsRefresh: true,
          accountId: account.accountId,
          refreshToken: account.refreshToken ?? undefined,
        };
      } else {
        return { token: null, needsRefresh: false };
      }
    }
  }

  return { token: account.accessToken, needsRefresh: false };
}
