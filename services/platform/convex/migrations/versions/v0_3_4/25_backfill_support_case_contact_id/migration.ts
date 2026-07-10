/**
 * DB migration: repoint `supportCases` onto `contacts` (issue #2618).
 *
 * The runner paginates `supportCases`; `up` looks up the contact migrated from
 * the case's `customerId` (via the contact's `metadata.__migratedFrom` stamp
 * written by 0.3.4/23) and sets `contactId`. `down` clears `contactId`. Both
 * are idempotent; `customerId` is never modified (it is dropped later in the
 * teardown phase), so `down` needs no snapshot. Cases without a `customerId`
 * (free-text requester only) are left as-is.
 */

import type { Doc, Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

/** The legacy FK table these support cases were linked to. */
const FROM_TABLE = 'customers';

function getStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The contact migrated from `customerId` within the org (stamp from 0.3.4/23). */
async function contactForCustomer(
  ctx: MutationCtx,
  organizationId: string,
  customerId: string,
): Promise<Id<'contacts'> | null> {
  const contacts = await ctx.db
    .query('contacts')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();
  const match = contacts.find((c: Doc<'contacts'>) => {
    const from = asRecord(asRecord(c.metadata)?.__migratedFrom);
    return from?.table === FROM_TABLE && from?.id === customerId;
  });
  return match?._id ?? null;
}

export const migration = defineDbMigration({
  title: 'Backfill supportCases.contactId from customerId',
  description:
    'Sets supportCases.contactId to the contact migrated from the linked ' +
    'customer (via metadata.__migratedFrom). Idempotent; down clears contactId ' +
    'and leaves customerId untouched.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.3.4/05_backfill_support_case_contact_id'],
  subjects: { tables: ['supportCases', 'contacts'] },
  table: 'supportCases',

  async up(ctx, doc) {
    if (doc.contactId) return; // already repointed
    const organizationId = getStr(doc.organizationId);
    const customerId = getStr(doc.customerId);
    if (!organizationId || !customerId) return;

    const contactId = await contactForCustomer(ctx, organizationId, customerId);
    if (!contactId) return;

    await ctx.db.patch(doc._id as Id<'supportCases'>, { contactId });
  },

  async down(ctx, doc) {
    if (!doc.contactId) return;
    await ctx.db.patch(doc._id as Id<'supportCases'>, {
      contactId: undefined,
    });
  },
});
