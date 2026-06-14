/**
 * Reference migration: drop `usageLedger.estimatedCostEur` +
 * `estimatedCostUsd`.
 *
 * Per-row, idempotent, shape-guarded. `up` removes both fields (lossy);
 * `down` backfills both to `0` (structural reversal only — the true historic
 * per-currency amounts are unrecoverable). The runner never executes a
 * `reference` migration; the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

export const migration: DbMigration = {
  meta,
  table: 'usageLedger',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    // Already migrated (neither field present) → no-op.
    if (
      doc.estimatedCostEur === undefined &&
      doc.estimatedCostUsd === undefined
    )
      return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy fields absent from schema
    await (ctx.db as any).patch(doc._id, {
      estimatedCostEur: undefined,
      estimatedCostUsd: undefined,
    });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    // Already restored → no-op.
    if (
      typeof doc.estimatedCostEur === 'number' &&
      typeof doc.estimatedCostUsd === 'number'
    )
      return;
    // Structural reversal only: original amounts are unrecoverable, backfill 0.
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy fields absent from schema
    await (ctx.db as any).patch(doc._id, {
      estimatedCostEur: 0,
      estimatedCostUsd: 0,
    });
  },
};
