import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.87 / 04 — drop the legacy `orgPackagePolicy` rows now that 02 exported
 * them to per-org `run-code.json` files.
 *
 * Contract step (DESTRUCTIVE): each row is snapshotted into `migrationSnapshots`
 * before deletion, so `down` (the generic snapshot-restore) rebuilds the table.
 * Gated behind explicit operator acceptance in the CLI.
 */
export const meta: MigrationMeta = {
  id: '0.2.87/04_drop_org_package_policy',
  semver: '0.2.87',
  numericId: 4,
  slug: 'drop_org_package_policy',
  title: 'Drop the legacy orgPackagePolicy rows (post-export cleanup)',
  description:
    'Deletes every legacy orgPackagePolicy row after snapshotting it. The ' +
    'run-code.json files written by 0.2.87/02 are the source of truth from ' +
    'here on. down restores the rows from the snapshot. Run only after ' +
    'verifying the exported run_code policy files look correct.',
  kind: 'db',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};
