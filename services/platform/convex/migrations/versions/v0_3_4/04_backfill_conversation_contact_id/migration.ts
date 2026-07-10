/**
 * DB migration: repoint `conversations` onto `contacts` (issue #2618).
 *
 * The runner paginates `conversations`; `up` looks up the contact migrated from
 * the conversation's `customerId` (via the contact's `metadata.__migratedFrom`
 * stamp written by 0.3.4/03) and sets `contactId`. `down` clears `contactId`.
 * Both are idempotent; `customerId` is never modified (it is dropped later in
 * the teardown phase), so `down` needs no snapshot.
 */

import type { Doc, Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

/** The legacy FK table these conversations were linked to. */
const FROM_TABLE = 'customers';

function getStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The contact migrated from `customerId` within the org (stamp from 0.3.4/03). */
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
  title: 'Backfill conversation.contactId from customerId',
  description:
    'Sets conversations.contactId to the contact migrated from the linked ' +
    'customer (via metadata.__migratedFrom). Idempotent; down clears contactId ' +
    'and leaves customerId untouched.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['conversations', 'contacts'] },
  table: 'conversations',

  async up(ctx, doc) {
    if (doc.contactId) return; // already repointed
    const organizationId = getStr(doc.organizationId);
    const customerId = getStr(doc.customerId);
    if (!organizationId || !customerId) return;

    const contactId = await contactForCustomer(ctx, organizationId, customerId);
    if (!contactId) return;

    await ctx.db.patch(doc._id as Id<'conversations'>, { contactId });
  },

  async down(ctx, doc) {
    if (!doc.contactId) return;
    await ctx.db.patch(doc._id as Id<'conversations'>, {
      contactId: undefined,
    });
  },
});
