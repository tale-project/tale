/**
 * Accounts API - Thin wrappers for OAuth account operations
 *
 * This file contains all public and internal Convex functions for OAuth accounts.
 * Business logic is in convex/model/accounts/
 */

import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { authComponent } from './auth';

// Import model functions and validators
import { oauthAccountValidator } from './model/accounts';
import * as MicrosoftAccountsModel from './model/accounts/microsoft';

// =============================================================================
// MICROSOFT OAUTH QUERIES
// =============================================================================

/**
 * Get Microsoft OAuth account for the current authenticated user
 *
 * This query accesses the Better Auth component's account storage
 * to retrieve Microsoft OAuth tokens for the authenticated user.
 */
export const getMicrosoftAccount = query({
  args: {},
  returns: v.union(v.null(), oauthAccountValidator),
  handler: async (ctx) => {
    return await MicrosoftAccountsModel.getMicrosoftAccount(ctx);
  },
});

/**
 * Check if current user has a Microsoft account connected
 */
export const hasMicrosoftAccount = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await MicrosoftAccountsModel.hasMicrosoftAccount(ctx);
  },
});

/**
 * Get Microsoft OAuth account for a specific user by userId
 * This is used for background jobs and scheduled syncs
 */
export const getMicrosoftAccountByUserId = query({
  args: { userId: v.string() },
  returns: v.union(v.null(), oauthAccountValidator),
  handler: async (ctx, args) => {
    return await MicrosoftAccountsModel.getMicrosoftAccountByUserId(
      ctx,
      args.userId,
    );
  },
});

// =============================================================================
// MICROSOFT OAUTH MUTATIONS
// =============================================================================

/**
 * Public mutation to update Microsoft account tokens
 * Called after token refresh to update stored tokens (authenticated users only)
 */
export const refreshAndUpdateTokens = mutation({
  args: {
    accountId: v.string(),
    accessToken: v.string(),
    accessTokenExpiresAt: v.union(v.number(), v.null()),
    refreshToken: v.optional(v.string()),
    refreshTokenExpiresAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify user is authenticated
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    // Call shared business logic to update tokens
    await MicrosoftAccountsModel.updateMicrosoftTokens(ctx, args);
    return null;
  },
});
