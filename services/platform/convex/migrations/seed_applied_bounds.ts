/**
 * One-shot migration: seed `retentionAppliedBounds` for every org that
 * has a `retention_policy` row but no applied bounds snapshot yet.
 *
 * After the explicit-apply-gate landed, cleanup reads bounds from the
 * `retentionAppliedBounds` table instead of the JSON file. Existing
 * orgs that enabled retention before this change have no row →
 * cleanup skips them with a warning until a row is seeded.
 *
 * This script delegates to `seedInitialBoundsInternal` (the same path
 * the first-enable hook in `upsertRetentionPolicyInternal` uses), so
 * the audit row, idempotency, and config-missing handling all match.
 * Re-running is safe — orgs with an existing applied row are
 * skipped silently.
 *
 * Invoked via `npx convex run migrations/seed_applied_bounds:apply`.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

export const apply = internalAction({
  args: {},
  returns: v.object({
    seeded: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    const policies = await ctx.runQuery(
      internal.governance.internal_queries.listRetentionPolicies,
      {},
    );
    let seeded = 0;
    let skipped = 0;
    for (const policy of policies) {
      const result = await ctx.runAction(
        internal.governance.retention_bounds_proposal.seedInitialBoundsInternal,
        {
          organizationId: policy.organizationId,
          actorId: 'system_migration',
          actorEmail: undefined,
          actorType: 'system',
        },
      );
      if (result === null) {
        skipped += 1;
      } else {
        seeded += 1;
      }
    }
    console.log(`[seed_applied_bounds] seeded=${seeded} skipped=${skipped}`);
    return { seeded, skipped };
  },
});
