import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.85 / 02 — move staged DSAR "loosen-grace" changes off the legacy
 * `governancePolicies` row's `pending*` fields into the dedicated
 * `dsarPolicyPendingChanges` table.
 *
 * Expand step: reads the legacy `pending*` fields and materialises a pending
 * row; leaves the legacy row intact (dropped by 03). Reversible — `down` folds
 * the pending row back onto the legacy row and deletes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.85/02_dsar_pending_table_split',
  semver: '0.2.85',
  numericId: 2,
  slug: 'dsar_pending_table_split',
  title: 'Move staged DSAR policy changes into dsarPolicyPendingChanges',
  description:
    'For each legacy governancePolicies row carrying staged (pending*) DSAR ' +
    'changes, inserts an equivalent dsarPolicyPendingChanges row. Idempotent ' +
    '(skips orgs that already have a pending row). down folds the pending row ' +
    'back onto the legacy row.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
