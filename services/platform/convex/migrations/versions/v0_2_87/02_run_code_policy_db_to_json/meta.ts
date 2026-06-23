import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.87 / 02 — export the DB-backed `orgPackagePolicy` row to the file-based
 * `run_code` governance policy.
 *
 * Expand step of the run_code cutover: for each org with a legacy
 * `orgPackagePolicy` row, writes `<org>/governance/run-code.json` (the new
 * source of truth) and re-syncs the configCache mirror. Non-destructive — the
 * legacy rows are dropped later by 0.2.87/04. A per-org fs-tree snapshot of the
 * governance directory is taken first so `down` can restore the prior files.
 * Idempotent (re-running overwrites the same file).
 */
export const meta: MigrationMeta = {
  id: '0.2.87/02_run_code_policy_db_to_json',
  semver: '0.2.87',
  numericId: 2,
  slug: 'run_code_policy_db_to_json',
  title: 'Export orgPackagePolicy to the file-based run_code governance policy',
  description:
    'For each org with a legacy orgPackagePolicy row, writes its ' +
    'run-code.json (defaultMode + python/node allow/deny lists) under ' +
    '<org>/governance/, then re-syncs the configCache mirror. Non-destructive ' +
    'to the database — the legacy rows are dropped by 0.2.87/04. A per-org ' +
    'fs-tree snapshot of the governance directory is taken first so down can ' +
    'restore the prior files.',
  kind: 'node',
  reversible: true,
  destructive: false,
  snapshot: 'fs-tree',
};
