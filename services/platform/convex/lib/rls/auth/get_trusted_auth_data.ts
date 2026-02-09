/**
 * Helper to extract trusted auth data (role, teams) from JWT identity.
 *
 * In trusted headers mode, the role and team IDs are stored in the session
 * and included in the JWT claims. This helper extracts and parses that data.
 */

import type {
  QueryCtx,
  MutationCtx,
  ActionCtx,
} from '../../../_generated/server';

export interface TrustedAuthData {
  trustedRole: string;
  trustedTeamIds: string[];
}

/**
 * Get trusted auth data from JWT identity if available.
 *
 * Returns null if:
 * - User is not authenticated
 * - JWT doesn't contain trusted headers data (normal auth mode)
 *
 * Returns TrustedAuthData if the JWT contains trustedRole claim.
 */
export async function getTrustedAuthData(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<TrustedAuthData | null> {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    return null;
  }

  // Check if JWT contains trusted headers data
  const trustedRole = (identity as any).trustedRole;

  if (!trustedRole) {
    // Not in trusted headers mode (or trustedRole not set)
    return null;
  }

  // Parse trustedTeamIds from JSON string with runtime validation
  const trustedTeamIdsRaw = (identity as { trustedTeamIds?: string })
    .trustedTeamIds;
  let trustedTeamIds: string[] = [];

  if (trustedTeamIdsRaw) {
    try {
      const parsed = JSON.parse(trustedTeamIdsRaw);
      if (
        Array.isArray(parsed) &&
        parsed.every((id) => typeof id === 'string')
      ) {
        trustedTeamIds = parsed;
      }
    } catch {
      trustedTeamIds = [];
    }
  }

  return {
    trustedRole,
    trustedTeamIds,
  };
}

/**
 * Check if the current request is in trusted headers mode.
 *
 * This checks if the JWT contains trustedRole claim, which indicates
 * the user authenticated via trusted headers.
 */
export async function isTrustedHeadersAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<boolean> {
  const data = await getTrustedAuthData(ctx);
  return data !== null;
}
