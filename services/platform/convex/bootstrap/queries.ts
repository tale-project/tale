import { v } from 'convex/values';

/**
 * Consolidated dashboard bootstrap query.
 *
 * On a cold load the authenticated dashboard previously fired several separate
 * gate queries — `two_factor.queries.getStatus` and
 * `users.queries.getPasswordExpiryStatus` — as independent WebSocket
 * round-trips, each re-deriving the caller's identity. Worse, the 2FA gate
 * blocked the entire dashboard render until it resolved, serializing the
 * remaining queries behind it.
 *
 * This query returns every org-independent gate result in ONE Convex
 * transaction / ONE WebSocket round-trip. It composes the exact same helpers
 * the legacy queries now wrap (`computeTwoFactorStatus`,
 * `computePasswordExpiry`), so there is no behavioral or security drift — the
 * 2FA `decision` is byte-for-byte the same value the fail-closed gate reads.
 *
 * Org-scoped membership (`getCurrentMemberContext`) is intentionally NOT folded
 * in: it needs an `organizationId` and lives on the `/dashboard/$id` layout,
 * where its own loader prefetch already runs concurrently with this query.
 */
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import {
  computeTwoFactorStatus,
  twoFactorStatusValidator,
} from '../two_factor/queries';
import {
  computePasswordExpiry,
  passwordExpiryValidator,
} from '../users/queries';

export const getAccountBootstrap = query({
  args: {},
  returns: v.object({
    twoFactor: twoFactorStatusValidator,
    passwordExpiry: passwordExpiryValidator,
  }),
  handler: async (ctx) => {
    // Resolve identity once (0 DB queries — JWT claims) and fan the two
    // independent computations out in parallel within this single transaction.
    const authUser = await getAuthUserIdentity(ctx);
    const [twoFactor, passwordExpiry] = await Promise.all([
      computeTwoFactorStatus(ctx, authUser),
      computePasswordExpiry(ctx, authUser),
    ]);
    return { twoFactor, passwordExpiry };
  },
});
