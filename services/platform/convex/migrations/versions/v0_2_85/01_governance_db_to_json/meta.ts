import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.85 / 01 — export DB-backed governance policies to per-org JSON files.
 *
 * The first half of the DB→files cutover (expand): writes the files, leaves the
 * legacy `governancePolicies` rows untouched. The DSAR pending split (02) and
 * the legacy-table drop (03) complete the cutover.
 */
export const meta: MigrationMeta = {
  id: '0.2.85/01_governance_db_to_json',
  semver: '0.2.85',
  numericId: 1,
  slug: 'governance_db_to_json',
  title: 'Export governance policies from the database to per-org JSON files',
  description:
    'For every organization, reads each legacy governancePolicies row and ' +
    'writes it to its canonical per-org JSON file under <org>/governance/, ' +
    'then re-syncs the configCache mirror. Non-destructive to the database — ' +
    'the legacy rows are dropped later by 0.2.85/03. A per-org filesystem ' +
    'snapshot of the governance directory is taken first so down can restore ' +
    'the prior files.',
  kind: 'node',
  reversible: true,
  destructive: false,
  snapshot: 'fs-tree',
};
