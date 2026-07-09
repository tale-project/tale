import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.3.4 / 02 — backfill the new `contacts` table from `vendors` (issue #2618,
 * Customers + Vendors → Contacts). Copies each vendors row into contacts,
 * stamping the new row's `metadata.__migratedFrom` with its origin. Idempotent
 * (skips vendors already migrated). `down` deletes the contacts created from
 * vendors; the source `vendors` rows are never modified.
 */
export const meta: MigrationMeta = {
  id: '0.3.4/02_backfill_contacts_from_vendors',
  semver: '0.3.4',
  numericId: 2,
  slug: 'backfill_contacts_from_vendors',
  title: 'Backfill contacts from vendors',
  description:
    'Copies every vendors row into the new contacts table, recording the ' +
    'origin in metadata.__migratedFrom. Idempotent; down removes the contacts ' +
    'materialized from vendors and leaves the vendors rows untouched.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
