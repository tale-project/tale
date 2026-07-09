import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.3.4 / 05 — repoint support cases onto contacts (issue #2618). For each
 * support case linked to a customer, sets `contactId` to the contact migrated
 * from that customer (matched via the contact's `metadata.__migratedFrom` stamp
 * written by 0.3.4/03). Idempotent (skips cases already carrying contactId).
 * `down` clears contactId; `customerId` is left in place (dropped later in the
 * teardown phase). Cases with a free-text requester and no customer are skipped.
 */
export const meta: MigrationMeta = {
  id: '0.3.4/05_backfill_support_case_contact_id',
  semver: '0.3.4',
  numericId: 5,
  slug: 'backfill_support_case_contact_id',
  title: 'Backfill supportCases.contactId from customerId',
  description:
    'Sets supportCases.contactId to the contact migrated from the linked ' +
    'customer (via metadata.__migratedFrom). Idempotent; down clears contactId ' +
    'and leaves customerId untouched.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
