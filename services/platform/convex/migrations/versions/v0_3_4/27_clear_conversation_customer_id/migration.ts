/**
 * 0.3.4 / 27 — clear `conversations.customerId` ahead of the schema drop.
 *
 * The contacts merge (#2618) removes `customerId` from the conversations
 * schema; Convex validates existing rows against the new schema, so rows must
 * shed the field before a deployment can hold the release. The runner
 * paginates `conversations`; `up` unsets `customerId` on rows whose link was
 * repointed to `contactId` (0.3.4/24) — the value stays RECOVERABLE through
 * the contact's `metadata.__migratedFrom` stamp, which `down` reads to
 * restore the original id byte-for-byte. Rows with a `customerId` but no
 * `contactId` (their customer vanished before the backfills) are left
 * untouched rather than destroyed. Both directions are idempotent.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

function getStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The customers `_id` the row's contact was migrated from (0.3.4/23 stamp). */
export async function customerIdFromStamp(
  ctx: MutationCtx,
  contactId: string,
): Promise<string | null> {
  const contact = await ctx.db.get(contactId as Id<'contacts'>);
  const from = asRecord(asRecord(contact?.metadata)?.__migratedFrom);
  if (from?.table !== 'customers') return null;
  return getStr(from.id) ?? null;
}

export const migration = defineDbMigration({
  title: 'Clear conversations.customerId (repointed to contactId)',
  description:
    'Unsets conversations.customerId on rows whose link 0.3.4/24 repointed ' +
    'to contactId, so existing rows satisfy the schema that drops the field. ' +
    'down restores the original customerId from the contact ' +
    'metadata.__migratedFrom stamp; rows without a contactId are never ' +
    'touched. Both directions idempotent.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['conversations', 'contacts'] },
  table: 'conversations',

  async up(ctx, doc) {
    if (doc.customerId === undefined) return; // already cleared
    if (doc.contactId === undefined) return; // unrepointed row — keep the id
    await ctx.db.patch(
      doc._id as Id<'conversations'>,
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
      doc._id as Id<'conversations'>,
      {
        // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
        customerId,
      } as any,
    );
  },
});
