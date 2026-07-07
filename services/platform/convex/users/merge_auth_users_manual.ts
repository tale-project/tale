import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { mergeAuthUsersManual } from '../lib/auth/merge_auth_users';

/**
 * Ops-only escape hatch for case-variant duplicate users the batched migration
 * skipped (e.g. dual-owner conflicts). Invoke via `convex run` on demand.
 */
export const mergeAuthUsersManualMutation = internalMutation({
  args: {
    canonicalUserId: v.string(),
    duplicateUserId: v.string(),
  },
  returns: v.object({ merged: v.boolean() }),
  handler: async (ctx, args) =>
    mergeAuthUsersManual(ctx, args.canonicalUserId, args.duplicateUserId),
});
