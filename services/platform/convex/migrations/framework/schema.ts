/**
 * Ledger + snapshot tables for the versioned data-migration framework.
 *
 * `migrationLedger` is the authoritative record of which migrations have been
 * applied (and which are mid-flight). The runner computes the pending set and
 * the rollback set from it, and uses the per-row cursor fields to resume an
 * interrupted run. `migrationSnapshots` holds the pre-`up` backups that
 * destructive migrations rely on so their `down` can rebuild lost data.
 *
 * Registered in `convex/schema.ts` as `migrationLedger` / `migrationSnapshots`.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * One row per (migration, latest-run). The runner upserts a `running` row when
 * it starts a migration and patches it to a terminal status when done; the
 * status + direction together describe the migration's current state in the
 * deployment's history.
 */
export const migrationLedgerTable = defineTable({
  /** `MigrationMeta.id`, e.g. `"0.2.85/01_governance_db_to_json"`. */
  migrationId: v.string(),
  semver: v.string(),
  numericId: v.number(),
  /** Zero-padded compound key (see `semver.buildOrderKey`) for canonical sort. */
  orderKey: v.string(),
  /** Direction of the latest run for this migration. */
  direction: v.union(v.literal('up'), v.literal('down')),
  status: v.union(
    v.literal('running'),
    v.literal('applied'),
    v.literal('rolledBack'),
    v.literal('failed'),
  ),
  // --- resumability -------------------------------------------------------
  /** Pagination cursor for `db` migrations (advanced per committed batch). */
  cursor: v.optional(v.union(v.string(), v.null())),
  /** Org-pagination cursor for `node` migrations. */
  orgCursor: v.optional(v.union(v.string(), v.null())),
  /** Org ids already fully processed this run (node migrations). */
  processedOrgs: v.optional(v.array(v.string())),
  // --- bookkeeping --------------------------------------------------------
  /** Reference into `migrationSnapshots` (or a sidecar path) for `down`. */
  snapshotRef: v.optional(v.string()),
  appliedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  /** Populated when `status === 'failed'`. */
  error: v.optional(v.string()),
})
  .index('by_migrationId', ['migrationId'])
  .index('by_orderKey', ['orderKey'])
  .index('by_status', ['status']);

/**
 * Pre-`up` backups for destructive migrations. Small row dumps live inline in
 * `payload`; anything that would breach Convex's ~1 MB document cap (large
 * table dumps, fs-tree archives) is written to a gitignored sidecar under
 * `$TALE_CONFIG_DIR/.migration-snapshots/<id>/` and only `externalRef` is
 * stored here.
 */
export const migrationSnapshotsTable = defineTable({
  migrationId: v.string(),
  /** Present for per-org (node) snapshots; absent for whole-table dumps. */
  orgId: v.optional(v.string()),
  /** Free-form scope label, e.g. `"table:governancePolicies"` / `"fs:governance"`. */
  scope: v.string(),
  /** Inline snapshot payload when small enough to live in Convex. */
  payload: v.optional(v.any()),
  /** Sidecar path when the snapshot is too large for an inline payload. */
  externalRef: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_migration', ['migrationId'])
  .index('by_migration_org', ['migrationId', 'orgId']);
