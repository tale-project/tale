import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.93 / 04 — move rows from legacy `appInstallations` into
 * `automationInstallations` and delete the legacy row.
 *
 * Runs after 01–03 field renames. Idempotent: a row already present in the
 * target table causes the legacy row to be dropped without re-inserting.
 */
export const meta: MigrationMeta = {
  id: '0.2.93/04_app_installations_table',
  semver: '0.2.93',
  numericId: 4,
  slug: 'app_installations_table',
  title: 'Rename appInstallations table to automationInstallations',
  description:
    'Copies each appInstallations row into automationInstallations and deletes ' +
    'the legacy row. Reversible via down (tests call down on target rows).',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
