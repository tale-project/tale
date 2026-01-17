/**
 * Convex validators for accounts domain
 *
 * Accounts use Better Auth for storage - no schema table.
 * Note: The OAuthAccount type uses nullable fields which are not supported by zodToConvex.
 * Types are exported from lib/shared/schemas/accounts for use in TypeScript code.
 */

import { v } from 'convex/values';

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
