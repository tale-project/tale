/**
 * Migration: Backfill usageLedger.granularity for legacy rows.
 *
 * The analytics dashboard query scans by (organizationId, granularity, periodKey)
 * to avoid mixing daily/weekly/monthly rows in a single scan. Pre-existing rows
 * lack the granularity field — infer it from periodKey format:
 *   10 chars (YYYY-MM-DD) → daily
 *   contains 'W'         → weekly
 *   7 chars  (YYYY-MM)   → monthly
 *
 * Idempotent: rows with granularity already set are skipped.
 * Invoked indirectly via services/platform/convex/migrations.ts:runAll.
 */

import { internalMutation } from '../_generated/server';

const BATCH = 500;

function inferGranularity(
  periodKey: string,
): 'daily' | 'weekly' | 'monthly' | null {
  if (periodKey.length === 10 && periodKey[4] === '-' && periodKey[7] === '-') {
    return 'daily';
  }
  if (periodKey.includes('W')) {
    return 'weekly';
  }
  if (periodKey.length === 7 && periodKey[4] === '-') {
    return 'monthly';
  }
  return null;
}

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;
    let updated = 0;
    let skipped = 0;
    let unknown = 0;

    while (!isDone) {
      const page = await ctx.db
        .query('usageLedger')
        .paginate({ cursor, numItems: BATCH });

      for (const row of page.page) {
        if (row.granularity) {
          skipped++;
          continue;
        }
        const granularity = inferGranularity(row.periodKey);
        if (!granularity) {
          unknown++;
          console.warn(
            `[backfill_ledger_granularity] unrecognized periodKey format: ${row.periodKey} (row ${row._id})`,
          );
          continue;
        }
        await ctx.db.patch(row._id, { granularity });
        updated++;
      }

      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    console.log(
      `[backfill_ledger_granularity] updated=${updated} skipped=${skipped} unknown=${unknown}`,
    );
    return { updated, skipped, unknown };
  },
});
