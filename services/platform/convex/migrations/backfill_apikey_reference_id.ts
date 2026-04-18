/**
 * Migration: Backfill apikey.referenceId from legacy apikey.userId.
 *
 * better-auth 1.4 → 1.5 renamed the apikey.userId field to referenceId. This
 * iterates apikey rows owned by the betterAuth component and copies userId →
 * referenceId for any row that only has the legacy field.
 *
 * Idempotent: rows that already have referenceId are skipped. userId is left
 * in place (the better-auth adapter can only SET fields); a follow-up
 * migration can delete it once the schema override is tightened.
 *
 * configId is NOT backfilled — better-auth 1.5 treats missing/null configId
 * as the default configuration by design.
 *
 * Invoked indirectly via services/platform/convex/migrations.ts:runAll which
 * is called from docker-entrypoint.sh after `bunx convex deploy` succeeds.
 */

import { getString, isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const BATCH = 200;

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;
    let updated = 0;
    let skipped = 0;

    while (!isDone) {
      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'apikey',
          paginationOpts: { cursor, numItems: BATCH },
          where: [],
        },
      );

      const page = isRecord(res) && Array.isArray(res.page) ? res.page : [];

      for (const row of page) {
        if (!isRecord(row)) continue;
        const id = getString(row, '_id');
        const ref = getString(row, 'referenceId');
        const uid = getString(row, 'userId');
        if (!id || ref || !uid) {
          skipped++;
          continue;
        }

        await ctx.runMutation(components.betterAuth.adapter.updateMany, {
          input: {
            model: 'apikey',
            where: [{ field: '_id', value: id, operator: 'eq' }],
            update: { referenceId: uid },
          },
          paginationOpts: { cursor: null, numItems: 1 },
        });
        updated++;
      }

      cursor =
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null;
      isDone =
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true;
    }

    console.log(
      `[backfill_apikey_reference_id] updated=${updated} skipped=${skipped}`,
    );
    return { updated, skipped };
  },
});
