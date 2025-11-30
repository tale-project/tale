/**
 * Accounts Model - Shared types and validators
 * 
 * This module contains shared types and validators for OAuth account management.
 */

import { v } from 'convex/values';

/**
 * OAuth account information returned from queries
 */
export const oauthAccountValidator = v.object({
  accountId: v.string(),
  userId: v.string(),
  providerId: v.string(),
  accessToken: v.union(v.string(), v.null()),
  accessTokenExpiresAt: v.union(v.number(), v.null()),
  refreshToken: v.union(v.string(), v.null()),
  refreshTokenExpiresAt: v.union(v.number(), v.null()),
  scope: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * TypeScript type for OAuth account
 */
export type OAuthAccount = {
  accountId: string;
  userId: string;
  providerId: string;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
  scope: string | null;
  createdAt: number;
  updatedAt: number;
};

