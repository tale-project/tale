import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.14 / 01 — drop the required `estimatedCostEur` + `estimatedCostUsd`
 * fields from `usageLedger`.
 *
 * Shipped in v0.2.14 (verified against `git diff v0.2.13 v0.2.14 --
 * convex/governance/schema.ts`): both `v.number()` fields were removed from
 * `usageLedgerTable` (the canonical cost lives in the retained `costEstimate`
 * field).
 *
 * up: unset both `estimatedCostEur` and `estimatedCostUsd` (information loss —
 * the original per-currency values are NOT recoverable from the remaining
 * columns).
 * down: restore both fields to `0`. This is a structural reversal only: the
 * pre-removal values cannot be reconstructed, so `down` backfills `0` rather
 * than the true historic amounts.
 *
 * Marked `destructive: true` (up loses data). Conceptually a `table-rows`
 * snapshot would have been needed to truly reverse it; as a reference
 * migration we record the `0`-backfill `down` and document the limitation.
 * The runner never executes a `reference` migration.
 */
export const meta: MigrationMeta = {
  id: '0.2.14/01_usage_ledger_drop_cost_fields',
  semver: '0.2.14',
  numericId: 1,
  slug: 'usage_ledger_drop_cost_fields',
  title: 'Drop usageLedger.estimatedCostEur / estimatedCostUsd',
  description:
    'Removes the required estimatedCostEur and estimatedCostUsd fields from ' +
    'usageLedger rows (canonical cost stays in costEstimate). up unsets both ' +
    'fields — the original per-currency amounts are not recoverable. down ' +
    'restores both to 0 (structural reversal only; true historic values cannot ' +
    'be reconstructed).',
  kind: 'reference',
  reversible: true,
  destructive: true,
  snapshot: 'none',
};
