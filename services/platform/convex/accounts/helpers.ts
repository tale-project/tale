/**
 * Accounts domain helpers - Business logic for OAuth account operations
 *
 * Accounts use Better Auth for storage.
 */

import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { OAuthAccount, UpdateTokensArgs } from './types';

import { components } from '../_generated/api';
import { authComponent } from '../auth';
import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_ACCOUNTS', '[Accounts]');

// =============================================================================
// CREDENTIAL ACCOUNT QUERIES
// =============================================================================

/**
 * Check if current user has a credential (password) account.
 * OAuth-only users (e.g. Microsoft SSO) won't have one.
 */
export async function hasCredentialAccount(ctx: QueryCtx): Promise<boolean> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) return false;

  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'account',
    where: [
      { field: 'userId', value: String(authUser._id), operator: 'eq' },
      { field: 'providerId', value: 'credential', operator: 'eq' },
    ],
    paginationOpts: { cursor: null, numItems: 1 },
  });

  return (result?.page?.length ?? 0) > 0;
}

// =============================================================================
// MICROSOFT ACCOUNT QUERIES
// =============================================================================

/**
 * Get Microsoft OAuth account for the current authenticated user.
 */
export async function getMicrosoftAccount(
  ctx: QueryCtx,
): Promise<OAuthAccount | null> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    console.warn('getMicrosoftAccount: No authenticated user');
    return null;
  }

  try {
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
      accounts: microsoftAccounts.map((acc: Record<string, unknown>) => ({
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

/**
 * Get Microsoft OAuth account for a specific user by userId.
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

    const microsoftAccounts = microsoftResult?.page || [];

    if (microsoftAccounts.length === 0) {
      console.warn(
        `getMicrosoftAccountByUserId: No Microsoft account found for user ${userId}`,
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
    console.error(
      `getMicrosoftAccountByUserId: Error retrieving Microsoft account for user ${userId}:`,
      error,
    );
    return null;
  }
}

/**
 * Check if current user has a Microsoft account connected.
 */
export async function hasMicrosoftAccount(ctx: QueryCtx): Promise<boolean> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) return false;

  try {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'account',
      where: [
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
        { field: 'providerId', value: 'microsoft', operator: 'eq' },
      ],
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
    });

    const accounts = result?.page ?? [];
    const accessToken = accounts[0]?.accessToken;
    return accounts.length > 0 && accessToken != null;
  } catch {
    return false;
  }
}

// =============================================================================
// MICROSOFT ACCOUNT MUTATIONS
// =============================================================================

/**
 * Update Microsoft account tokens in Better Auth storage.
 */
export async function updateMicrosoftTokens(
  ctx: MutationCtx,
  args: UpdateTokensArgs,
): Promise<void> {
  try {
    const accounts = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        where: [{ field: 'accountId', value: args.accountId, operator: 'eq' }],
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
      },
    );

    if (!accounts || accounts.length === 0) {
      throw new Error('Microsoft account not found');
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'account' as const,
        where: [{ field: 'accountId', value: args.accountId, operator: 'eq' }],
        update: {
          accessToken: args.accessToken,
          accessTokenExpiresAt: args.accessTokenExpiresAt,
          ...(args.refreshToken && { refreshToken: args.refreshToken }),
          ...(args.refreshTokenExpiresAt && {
            refreshTokenExpiresAt: args.refreshTokenExpiresAt,
          }),
          updatedAt: Date.now(),
        },
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
    });
  } catch (error) {
    console.error('updateMicrosoftTokens: Error updating tokens:', error);
    throw new Error('Failed to update Microsoft account tokens', {
      cause: error,
    });
  }
}
