/**
 * Pure planning logic for the migration runner: given the registered migration
 * metadata and the current ledger rows, decide what is applied, what is
 * pending, and what a roll-forward / roll-back plan looks like.
 *
 * Kept free of Convex ctx so it is exhaustively unit-testable in isolation —
 * the ordering, frontier, and pending math is the part most worth proving
 * correct, and it should never depend on a live database to test.
 */

import { buildOrderKey, compareSemver } from './semver';
import { isRunnableKind, type MigrationMeta } from './types';

/** The latest ledger row for a migration, reduced to what the planner needs. */
export interface LedgerState {
  readonly migrationId: string;
  readonly direction: 'up' | 'down';
  readonly status: 'running' | 'applied' | 'rolledBack' | 'failed';
}

export interface PlanStep {
  readonly meta: MigrationMeta;
  readonly orderKey: string;
}

/** Sort metas into the canonical global order (semver, then numericId). */
export function orderMigrations(metas: readonly MigrationMeta[]): PlanStep[] {
  return metas
    .map((meta) => ({
      meta,
      orderKey: buildOrderKey(meta.semver, meta.numericId),
    }))
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

/** A migration counts as applied iff its latest ledger row is `applied`. */
export function isApplied(
  migrationId: string,
  ledger: ReadonlyMap<string, LedgerState>,
): boolean {
  return ledger.get(migrationId)?.status === 'applied';
}

/** Index ledger rows by migrationId for O(1) lookup. */
export function indexLedger(
  rows: readonly LedgerState[],
): Map<string, LedgerState> {
  const map = new Map<string, LedgerState>();
  for (const row of rows) map.set(row.migrationId, row);
  return map;
}

/**
 * View ledger rows recorded under a migration's FORMER id as rows of its
 * current id (read-side counterpart of the ledger adoption the apply actions
 * perform). A row under the current id wins over any former-id row, so the
 * fold is safe against half-adopted states. Pure — used by the status/plan
 * queries, which cannot write.
 */
export function foldLedgerAliases<T extends LedgerState>(
  rows: readonly T[],
  metas: readonly MigrationMeta[],
): T[] {
  const currentIdByFormer = new Map<string, string>();
  for (const meta of metas) {
    for (const formerId of meta.formerIds ?? []) {
      currentIdByFormer.set(formerId, meta.id);
    }
  }
  if (currentIdByFormer.size === 0) return [...rows];

  const present = new Set(rows.map((r) => r.migrationId));
  return rows.map((row) => {
    const currentId = currentIdByFormer.get(row.migrationId);
    if (currentId === undefined || present.has(currentId)) return row;
    return { ...row, migrationId: currentId };
  });
}

/**
 * The applied frontier: the highest orderKey among applied migrations, or null
 * when none are applied. Used purely for display.
 */
export function appliedFrontier(
  steps: readonly PlanStep[],
  ledger: ReadonlyMap<string, LedgerState>,
): PlanStep | null {
  let frontier: PlanStep | null = null;
  for (const step of steps) {
    if (isApplied(step.meta.id, ledger)) frontier = step;
  }
  return frontier;
}

/**
 * Pending up-migrations in ascending order: every registered migration that is
 * not currently applied. When `toSemver` is given, stop after the last
 * migration whose semver is `<= toSemver` (inclusive).
 *
 * Note we do NOT require contiguity — a hole (e.g. a single failed migration in
 * the middle) still lists every later not-applied migration, and the runner
 * re-attempts them in order. Idempotent handlers make a re-attempt safe.
 */
export function computePendingUp(
  metas: readonly MigrationMeta[],
  ledgerRows: readonly LedgerState[],
  toSemver?: string,
): PlanStep[] {
  const ledger = indexLedger(ledgerRows);
  const steps = orderMigrations(metas);
  return steps.filter((step) => {
    if (!isRunnableKind(step.meta.kind)) return false;
    if (isApplied(step.meta.id, ledger)) return false;
    if (toSemver && compareSemver(step.meta.semver, toSemver) > 0) return false;
    return true;
  });
}

/**
 * Roll-back plan: applied migrations whose semver is strictly greater than
 * `toSemver`, in DESCENDING order (newest undone first). Bringing a deployment
 * "down to the baseline" reverts everything that shipped after it.
 */
export function computeRollback(
  metas: readonly MigrationMeta[],
  ledgerRows: readonly LedgerState[],
  toSemver: string,
): PlanStep[] {
  const ledger = indexLedger(ledgerRows);
  const steps = orderMigrations(metas);
  return steps
    .filter(
      (step) =>
        isApplied(step.meta.id, ledger) &&
        compareSemver(step.meta.semver, toSemver) > 0,
    )
    .toReversed();
}

/** Restrict a plan to an explicit allow-list of migration ids (preserve order). */
export function restrictToOnly(
  steps: readonly PlanStep[],
  only: readonly string[],
): PlanStep[] {
  const allow = new Set(only);
  return steps.filter((step) => allow.has(step.meta.id));
}
