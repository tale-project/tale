import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Operational state for the per-org blob BACKFILL — the operator/admin-triggered
 * move of an org's pre-existing Convex `_storage` blobs into its bring-your-own
 * S3 bucket (full data residency). One row per run; the newest row per org is
 * the status the admin UI polls.
 *
 * This is deliberately NOT a versioned migration (see
 * `backfill_actions.ts:migrateOrgBlobsToObjectStorage`): the move is org-scoped,
 * on-demand, and depends on per-org runtime config (the bucket connection), so a
 * deploy-coupled, run-once framework migration cannot express it. The run row
 * carries the resumable cursor + counters instead of the migration ledger.
 *
 * TENANT ISOLATION: rows are org-owned — always queried through
 * `by_organizationId`, never across orgs.
 */
export const objectStorageBackfillRunsTable = defineTable({
  organizationId: v.string(),
  /** Slug snapshot at start — keys the on-disk object-storage connection. */
  orgSlug: v.string(),
  /** Dry runs count + sample what WOULD move; they never write anything. */
  dryRun: v.boolean(),
  status: v.union(
    v.literal('running'),
    v.literal('completed'),
    v.literal('failed'),
  ),
  /**
   * Enumeration phase. Documents run FIRST so every `historyFiles` entry (which
   * has no reverse index) is rewritten before the fileMetadata phase deletes
   * anything — see the engine's ordering rationale.
   */
  phase: v.union(
    v.literal('documents'),
    v.literal('fileMetadata'),
    v.literal('done'),
  ),
  /** Resumable pagination cursor within the current phase (null = phase start). */
  cursor: v.union(v.string(), v.null()),
  /** Self-reschedule count — how many budget-sized actions this run chained. */
  continuation: v.number(),
  /** Rows enumerated so far (both phases, incl. rows with nothing to move). */
  rowsScanned: v.number(),
  /** Blobs fully moved: copied + verified + every row rewritten + source deleted. */
  migrated: v.number(),
  /**
   * Blobs whose rows were rewritten but whose `_storage` source was kept
   * because a row OUTSIDE the org still references it (delete withheld —
   * fail-safe for a cross-tenant share that should never exist).
   */
  skipped: v.number(),
  /** Blobs that errored (unreadable / PUT failed / verify mismatch) — logged and left intact. */
  failed: v.number(),
  bytesMigrated: v.number(),
  /** Dry-run: convex-backed refs that WOULD move (per phase; a ref shared across phases counts in each). */
  candidates: v.number(),
  candidateBytes: v.number(),
  /** Dry-run: capped preview of what would move. */
  sample: v.array(
    v.object({
      ref: v.string(),
      table: v.string(),
      name: v.optional(v.string()),
      size: v.optional(v.number()),
    }),
  ),
  startedAt: v.number(),
  /** Heartbeat — bumped per flushed page; a stale 'running' row is a crashed run. */
  updatedAt: v.number(),
  finishedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  /** Better Auth user id of the admin who triggered the run (unset = operator/CLI). */
  triggeredBy: v.optional(v.string()),
}).index('by_organizationId', ['organizationId']);
