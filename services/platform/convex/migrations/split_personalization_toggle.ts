/**
 * Migration: split the legacy single `personalization` toggle into two
 * independent gates — Custom Instructions and User Memories.
 *
 * Two tables are migrated in one pass:
 *
 *  1. `userPreferences` rows that carry the legacy `enabled` field have
 *     it copied into both `customInstructionsEnabled` and
 *     `memoriesEnabled` (since the old toggle gated both features
 *     together), then `enabled` is cleared.
 *
 *  2. `governancePolicies` rows with `policyType === 'personalization'`
 *     are forked into two new rows (`custom_instructions` and
 *     `user_memories`) carrying the same `config.enabled` value, after
 *     which the legacy row is deleted. If a target row already exists
 *     (admin partially migrated by hand) it is left untouched.
 *
 * Idempotent: rows already free of the legacy fields are skipped.
 * Invoked indirectly via `services/platform/convex/migrations.ts:runAll`.
 */

import { isRecord } from '../../lib/utils/type-guards';
import { internalMutation } from '../_generated/server';

const BATCH = 500;

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    let prefsCleared = 0;
    let policiesForked = 0;
    let policiesDeleted = 0;

    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page = await ctx.db
        .query('userPreferences')
        .paginate({ cursor, numItems: BATCH });

      for (const row of page.page) {
        const legacy = row.enabled;
        if (typeof legacy !== 'boolean') continue;
        const patch: {
          enabled?: undefined;
          customInstructionsEnabled?: boolean;
          memoriesEnabled?: boolean;
        } = { enabled: undefined };
        if (typeof row.customInstructionsEnabled !== 'boolean') {
          patch.customInstructionsEnabled = legacy;
        }
        if (typeof row.memoriesEnabled !== 'boolean') {
          patch.memoriesEnabled = legacy;
        }
        await ctx.db.patch(row._id, patch);
        prefsCleared++;
      }

      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    cursor = null;
    isDone = false;
    while (!isDone) {
      const page = await ctx.db
        .query('governancePolicies')
        .paginate({ cursor, numItems: BATCH });

      for (const policy of page.page) {
        if (policy.policyType !== 'personalization') continue;
        const config = isRecord(policy.config) ? policy.config : {};
        const enabled =
          typeof config['enabled'] === 'boolean' ? config['enabled'] : false;

        for (const target of [
          'custom_instructions',
          'user_memories',
        ] as const) {
          const existing = await ctx.db
            .query('governancePolicies')
            .withIndex('by_org_policyType', (q) =>
              q
                .eq('organizationId', policy.organizationId)
                .eq('policyType', target),
            )
            .first();
          if (existing) continue;
          await ctx.db.insert('governancePolicies', {
            organizationId: policy.organizationId,
            policyType: target,
            config: { enabled },
            enabled,
            updatedAt: policy.updatedAt,
            updatedBy: policy.updatedBy,
          });
          policiesForked++;
        }

        await ctx.db.delete(policy._id);
        policiesDeleted++;
      }

      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    console.log(
      `[split_personalization_toggle] prefsCleared=${prefsCleared} policiesForked=${policiesForked} policiesDeleted=${policiesDeleted}`,
    );
    return { prefsCleared, policiesForked, policiesDeleted };
  },
});
