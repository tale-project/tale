/**
 * Get Microsoft OAuth account - Business logic
 */

import type { QueryCtx } from '../../../_generated/server';
import { components } from '../../../_generated/api';
import { authComponent } from '../../../auth';
import type { OAuthAccount } from '../index';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_ACCOUNTS', '[Accounts]');

/**
 * Get Microsoft OAuth account for the current authenticated user
 *
 * This function accesses the Better Auth component's account storage
 * to retrieve Microsoft OAuth tokens for the authenticated user.
 */
async function getMicrosoftAccount(
  ctx: QueryCtx,
): Promise<OAuthAccount | null> {
  // Get current authenticated user
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    console.warn('getMicrosoftAccount: No authenticated user');
    return null;
  }

  try {
    // authUser._id is the Better Auth internal user ID
    // Note: authUser.userId is a different field (optional custom userId)
    const betterAuthInternalUserId = String(authUser._id);

    debugLog('getMicrosoftAccount: Looking for Microsoft account', {
      userId: betterAuthInternalUserId,
      authUserEmail: authUser.email,
      authUserObject: authUser,
    });

    const microsoftResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        where: [
          {
            field: 'userId',
            value: String(betterAuthInternalUserId),
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

    const microsoftAccounts = microsoftResult?.page || [];

    debugLog('getMicrosoftAccount: Query result', {
      foundAccounts: microsoftAccounts.length,
      accounts: microsoftAccounts.map((acc: any) => ({
        accountId: acc.accountId,
        providerId: acc.providerId,
        userId: acc.userId,
      })),
    });

    if (microsoftAccounts.length === 0) {
      console.warn(
        'getMicrosoftAccount: No Microsoft OAuth account found for user',
      );
      return null;
    }

    const account = microsoftAccounts[0];

    return {
      accountId: account.accountId,
      userId: account.userId,
      providerId: account.providerId,
      accessToken: account.accessToken ?? null,
      accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
      refreshToken: account.refreshToken ?? null,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? null,
      scope: account.scope ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  } catch (error) {
    console.error('getMicrosoftAccount: Error querying Better Auth:', error);
    return null;
  }
}
