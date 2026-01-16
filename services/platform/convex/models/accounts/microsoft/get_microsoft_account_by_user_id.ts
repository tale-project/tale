/**
 * Get Microsoft OAuth account for a specific user by userId
 */

import type { QueryCtx } from '../../../_generated/server';
import { components } from '../../../_generated/api';
import type { OAuthAccount } from '../index';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_ACCOUNTS', '[Accounts]');

/**
 * Get Microsoft OAuth account for a specific user by userId
 * This is used for background jobs and scheduled syncs that need to access
 * a specific user's Microsoft Graph credentials.
 */
export async function getMicrosoftAccountByUserId(
  ctx: QueryCtx,
  userId: string,
): Promise<OAuthAccount | null> {
  try {
    debugLog('getMicrosoftAccountByUserId: Looking for Microsoft account', {
      userId,
    });

    const microsoftResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        where: [
          {
            field: 'userId',
            value: userId,
            operator: 'eq',
          },
          { field: 'providerId', value: 'microsoft', operator: 'eq' },
        ],
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
      },
    );

    const microsoftAccounts: any[] =
      (microsoftResult as any)?.page ??
      (Array.isArray(microsoftResult) ? (microsoftResult as any[]) : []);

    if (!microsoftAccounts || microsoftAccounts.length === 0) {
      console.warn(
        `getMicrosoftAccountByUserId: No Microsoft account found for user ${userId}`,
      );
      return null;
    }

    const account = microsoftAccounts[0];

    // Return the account with proper typing
    return {
      accountId: account.accountId as string,
      userId: account.userId as string,
      providerId: account.providerId as string,
      accessToken: (account.accessToken as string | null) ?? null,
      accessTokenExpiresAt:
        (account.accessTokenExpiresAt as number | null) ?? null,
      refreshToken: (account.refreshToken as string | null) ?? null,
      refreshTokenExpiresAt:
        (account.refreshTokenExpiresAt as number | null) ?? null,
      scope: (account.scope as string | null) ?? null,
      createdAt: account.createdAt as number,
      updatedAt: account.updatedAt as number,
    };
  } catch (error) {
    console.error(
      `getMicrosoftAccountByUserId: Error retrieving Microsoft account for user ${userId}:`,
      error,
    );
    return null;
  }
}
