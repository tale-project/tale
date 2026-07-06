/**
 * Accounts domain helpers - Business logic for OAuth account operations
 *
 * Accounts use Better Auth for storage.
 */

import { getNumber, getString, isRecord } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import type { QueryCtx, MutationCtx } from '../_generated/server';
import { createDebugLog } from '../lib/debug_log';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { pickMicrosoftAccount, scopeGrantsOneDrive } from './microsoft_account';
import type { OAuthAccount, UpdateTokensArgs } from './types';

const debugLog = createDebugLog('DEBUG_ACCOUNTS', '[Accounts]');

// =============================================================================
// CREDENTIAL ACCOUNT QUERIES
// =============================================================================

/**
 * Check if current user has a credential (password) account.
 * OAuth-only users (e.g. Microsoft SSO) won't have one.
 */
export async function hasCredentialAccount(ctx: QueryCtx): Promise<boolean> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) return false;

  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'account',
    where: [
      { field: 'userId', value: authUser.userId, operator: 'eq' },
      { field: 'providerId', value: 'credential', operator: 'eq' },
    ],
    paginationOpts: { cursor: null, numItems: 1 },
  });

  return (result?.page?.length ?? 0) > 0;
}

// =============================================================================
// MICROSOFT ACCOUNT QUERIES
// =============================================================================

/** Narrow a Better Auth `account` row to the OAuth shape this module returns. */
function toOAuthAccount(row: unknown): OAuthAccount | null {
  if (!isRecord(row)) return null;
  const accountId = getString(row, 'accountId');
  const userId = getString(row, 'userId');
  const providerId = getString(row, 'providerId');
  const createdAt = getNumber(row, 'createdAt');
  const updatedAt = getNumber(row, 'updatedAt');
  if (
    accountId === undefined ||
    userId === undefined ||
    providerId === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return null;
  }
  return {
    accountId,
    userId,
    providerId,
    accessToken: getString(row, 'accessToken') ?? null,
    accessTokenExpiresAt: getNumber(row, 'accessTokenExpiresAt') ?? null,
    refreshToken: getString(row, 'refreshToken') ?? null,
    refreshTokenExpiresAt: getNumber(row, 'refreshTokenExpiresAt') ?? null,
    scope: getString(row, 'scope') ?? null,
    createdAt,
    updatedAt,
  };
}

/**
 * Find the account row holding the user's Microsoft Graph token. Matches both
 * the legacy `microsoft` social-login rows and the `entra-id` rows written by
 * Enterprise SSO (the Better Auth adapter ANDs `where` clauses, so provider
 * selection happens in code via `pickMicrosoftAccount`).
 */
async function findMicrosoftAccountForUser(
  ctx: QueryCtx,
  userId: string,
): Promise<OAuthAccount | null> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'account',
    where: [{ field: 'userId', value: userId, operator: 'eq' }],
    paginationOpts: {
      cursor: null,
      numItems: 20,
    },
  });

  const rows: unknown[] = result?.page ?? [];
  const accounts = rows
    .map(toOAuthAccount)
    .filter((row): row is OAuthAccount => row !== null);
  return pickMicrosoftAccount(accounts);
}

/**
 * Get Microsoft OAuth account for the current authenticated user.
 */
export async function getMicrosoftAccount(
  ctx: QueryCtx,
): Promise<OAuthAccount | null> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return null;
  }

  try {
    debugLog('getMicrosoftAccount: Looking for Microsoft account', {
      userId: authUser.userId,
      authUserEmail: authUser.email,
    });

    const account = await findMicrosoftAccountForUser(ctx, authUser.userId);
    if (!account) {
      console.warn(
        'getMicrosoftAccount: No Microsoft OAuth account found for user',
      );
      return null;
    }
    return account;
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

    const account = await findMicrosoftAccountForUser(ctx, userId);
    if (!account) {
      console.warn(
        `getMicrosoftAccountByUserId: No Microsoft account found for user ${userId}`,
      );
      return null;
    }
    return account;
  } catch (error) {
    console.error(
      `getMicrosoftAccountByUserId: Error retrieving Microsoft account for user ${userId}:`,
      error,
    );
    return null;
  }
}

/**
 * Check if current user has a Microsoft account connected that can reach
 * OneDrive/SharePoint. Gates the "From Microsoft 365" documents entry:
 * requires a live access token whose granted scopes include `Files.Read`
 * (rows without a recorded scope are treated as capable — see
 * `scopeGrantsOneDrive`).
 */
export async function hasMicrosoftAccount(ctx: QueryCtx): Promise<boolean> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) return false;

  try {
    const account = await findMicrosoftAccountForUser(ctx, authUser.userId);
    return account?.accessToken != null && scopeGrantsOneDrive(account.scope);
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
