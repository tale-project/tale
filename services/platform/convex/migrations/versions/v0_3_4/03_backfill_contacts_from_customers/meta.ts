import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.3.4 / 03 — backfill `contacts` from `customers` (issue #2618, Customers +
 * Vendors → Contacts). Copies each customers row into contacts, DROPPING the
 * customer-only `status` field (contacts is status-less by design). Idempotent
 * (skips customers already migrated). `down` deletes the contacts created from
 * customers; the source `customers` rows (incl. status) are never modified.
 */
export const meta: MigrationMeta = {
  id: '0.3.4/03_backfill_contacts_from_customers',
  semver: '0.3.4',
  numericId: 3,
  slug: 'backfill_contacts_from_customers',
  title: 'Backfill contacts from customers',
  description:
    'Copies every customers row into the new contacts table, dropping the ' +
    'customer-only status field and recording the origin in ' +
    'metadata.__migratedFrom. Idempotent; down removes the contacts ' +
    'materialized from customers and leaves the customers rows untouched.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
