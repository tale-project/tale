/**
 * 0.2.14 / 01 — drop the required `estimatedCostEur` + `estimatedCostUsd`
 * fields from `usageLedger`.
 *
 * Shipped in v0.2.14 (verified against `git diff v0.2.13 v0.2.14 --
 * convex/governance/schema.ts`): both `v.number()` fields were removed from
 * `usageLedgerTable` (the canonical cost lives in the retained `costEstimate`
 * field).
 *
 * Marked `destructive: true` (up loses data — the original per-currency
 * values are NOT recoverable from the remaining columns; down backfills `0`,
 * a structural reversal only). Conceptually a `table-rows` snapshot would
 * have been needed to truly reverse it; as a reference migration we record
 * the `0`-backfill `down` and document the limitation. The per-row transform
 * is idempotent and shape-guarded and stays under round-trip test for the
 * audit trail; the runner never executes a `reference` migration — the test
 * calls `up`/`down` directly.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Drop usageLedger.estimatedCostEur / estimatedCostUsd',
  description:
    'Removes the required estimatedCostEur and estimatedCostUsd fields from ' +
    'usageLedger rows (canonical cost stays in costEstimate). up unsets both ' +
    'fields — the original per-currency amounts are not recoverable. down ' +
    'restores both to 0 (structural reversal only; true historic values cannot ' +
    'be reconstructed).',
  destructive: true,
  snapshot: 'none',
  table: 'usageLedger',

  async up(ctx, doc) {
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

  async down(ctx, doc) {
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
});
