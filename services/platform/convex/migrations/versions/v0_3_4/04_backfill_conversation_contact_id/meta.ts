import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.3.4 / 04 — repoint conversations onto contacts (issue #2618). For each
 * conversation linked to a customer, sets `contactId` to the contact migrated
 * from that customer (matched via the contact's `metadata.__migratedFrom` stamp
 * written by 0.3.4/03). Idempotent (skips conversations already carrying
 * contactId). `down` clears contactId; `customerId` is left in place (dropped
 * later in the teardown phase).
 */
export const meta: MigrationMeta = {
  id: '0.3.4/04_backfill_conversation_contact_id',
  semver: '0.3.4',
  numericId: 4,
  slug: 'backfill_conversation_contact_id',
  title: 'Backfill conversation.contactId from customerId',
  description:
    'Sets conversations.contactId to the contact migrated from the linked ' +
    'customer (via metadata.__migratedFrom). Idempotent; down clears contactId ' +
    'and leaves customerId untouched.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
