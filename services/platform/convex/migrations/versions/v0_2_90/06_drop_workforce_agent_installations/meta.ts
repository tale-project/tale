import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 06 — drop installation rows of the retired workforce personas.
 *
 * The sibling node migration (0.2.90/05) deletes the persona agent FILES;
 * this db migration removes their `agentInstallations` rows so the roster
 * gate stops treating retired personas as installed. Rows are matched by the
 * 16 retired catalog slugs. Contract step (DESTRUCTIVE): each row is
 * snapshotted into `migrationSnapshots` before deletion, so `down` (the
 * generic snapshot-restore) rebuilds the rows.
 */
export const meta: MigrationMeta = {
  id: '0.2.90/06_drop_workforce_agent_installations',
  semver: '0.2.90',
  numericId: 6,
  slug: 'drop_workforce_agent_installations',
  title: 'Delete agentInstallations rows of the retired workforce personas',
  description:
    'Deletes every agentInstallations row whose agentSlug is one of the 16 ' +
    'retired workforce persona slugs (chief-executive-officer, analyst, …), ' +
    'after snapshotting it. Note: an org-authored custom agent that reused ' +
    'one of these exact slugs would lose its installation row too — restore ' +
    'via down if that ever bites. down restores the rows from the snapshot.',
  kind: 'db',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};
