/**
 * 0.3.4 / 28 — clear `supportCases.customerId` ahead of the schema drop.
 *
 * Sibling of 0.3.4/27 for support cases: the contacts merge (#2618) removes
 * `customerId` from the supportCases schema, so rows must shed the field
 * before a deployment can hold the release. `up` unsets `customerId` on rows
 * 0.3.4/25 repointed to `contactId`; `down` restores the original id from
 * the contact's `metadata.__migratedFrom` stamp. Rows with a `customerId`
 * but no `contactId` are left untouched. Both directions are idempotent.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';
import { customerIdFromStamp } from '../27_clear_conversation_customer_id/migration';

function getStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineDbMigration({
  title: 'Clear supportCases.customerId (repointed to contactId)',
  description:
    'Unsets supportCases.customerId on rows whose link 0.3.4/25 repointed ' +
    'to contactId, so existing rows satisfy the schema that drops the field. ' +
    'down restores the original customerId from the contact ' +
    'metadata.__migratedFrom stamp; rows without a contactId are never ' +
    'touched. Both directions idempotent.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['supportCases', 'contacts'] },
  table: 'supportCases',

  async up(ctx, doc) {
    if (doc.customerId === undefined) return; // already cleared
    if (doc.contactId === undefined) return; // unrepointed row — keep the id
    await ctx.db.patch(
      doc._id as Id<'supportCases'>,
      {
        // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
        customerId: undefined,
      } as any,
    );
  },

  async down(ctx, doc) {
    if (doc.customerId !== undefined) return; // already restored
    const contactId = getStr(doc.contactId);
    if (!contactId) return; // never had a repointed link
    const customerId = await customerIdFromStamp(ctx, contactId);
    if (!customerId) return; // contact not stamped (not a migrated customer)
    await ctx.db.patch(
      doc._id as Id<'supportCases'>,
      {
        // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
        customerId,
      } as any,
    );
  },
});
