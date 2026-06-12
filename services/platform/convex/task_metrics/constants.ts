/**
 * Task-metrics constants. Centralized so the sweeps, rollups, queries, and
 * the pack workflows' documentation all agree on the same numbers.
 */

/** A task in `in_progress` with no activity for this long counts as stale. */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * A `running` taskAgentRuns row older than this is presumed dead (the action
 * crashed before finalizing) and is flipped to `timed_out` by the stuck-run
 * sweep — which MUST go through `finalizeTaskAgentRun` so the concurrency
 * counters decrement. Sits well above the longest legitimate run (internal
 * ~8 min deadline; external runtimes default 30 min).
 */
export const RUN_STUCK_AFTER_MS = 60 * 60 * 1000;

/** Bounded-scan cap per org-day rollup pass; beyond it the row is `capped`. */
export const ROLLUP_MAX_SCAN = 20_000;

/** Daily rollup rows older than this are pruned in the rollup cron. */
export const ROLLUP_RETENTION_DAYS = 400;

/** Orgs processed per rollup cron invocation (cursor-chained continuation). */
export const ROLLUP_MAX_ORGS_PER_RUN = 200;
