import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.85 / 03 — drop the legacy `governancePolicies` rows now that 01 exported
 * them to files and 02 moved the staged DSAR changes out.
 *
 * Contract step (DESTRUCTIVE): each row is snapshotted into `migrationSnapshots`
 * before deletion, so `down` (a generic snapshot-restore) rebuilds the table.
 * Gated behind explicit operator acceptance in the CLI.
 */
export const meta: MigrationMeta = {
  id: '0.2.85/03_drop_legacy_governance_tables',
  semver: '0.2.85',
  numericId: 3,
  slug: 'drop_legacy_governance_tables',
  title: 'Drop the legacy governancePolicies rows (post-export cleanup)',
  description:
    'Deletes every legacy governancePolicies row after snapshotting it. The ' +
    'files written by 0.2.85/01 are the source of truth from here on. down ' +
    'restores the rows from the snapshot. Run only after verifying the ' +
    'exported governance files look correct.',
  kind: 'db',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};
