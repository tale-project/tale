/**
 * DB migration: backfill `contacts` from `vendors` (issue #2618).
 *
 * The runner paginates `vendors`; `up` copies each row into `contacts` (the
 * vendor shape is identical to the contact shape), stamping
 * `metadata.__migratedFrom = { table: 'vendors', id }` for provenance and
 * idempotency. `down` deletes the contacts materialized from vendors. Both are
 * idempotent; the source `vendors` rows are never modified (so `down` needs no
 * snapshot — it simply removes what `up` inserted).
 */

import type { WithoutSystemFields } from 'convex/server';

import type { Doc } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';
import type { MigrationDoc } from '../../../framework/types';

const SOURCE_TABLE = 'vendors';

function getStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The `{ table, id }` provenance stamp `up` writes onto each migrated contact. */
function migratedFrom(
  contact: Doc<'contacts'>,
): Record<string, unknown> | undefined {
  return asRecord(asRecord(contact.metadata)?.__migratedFrom);
}

async function contactsForOrg(
  ctx: MutationCtx,
  organizationId: string,
): Promise<Doc<'contacts'>[]> {
  return await ctx.db
    .query('contacts')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();
}

function toContactPayload(
  doc: MigrationDoc,
): WithoutSystemFields<Doc<'contacts'>> {
  const fields: Record<string, unknown> = { ...doc };
  delete fields._id;
  delete fields._creationTime;
  // contacts has no `status` (customer-only, dropped in the merge); harmless
  // for vendors, which never carry it.
  delete fields.status;
  fields.metadata = {
    ...asRecord(doc.metadata),
    __migratedFrom: { table: SOURCE_TABLE, id: String(doc._id) },
  };
  // The legacy vendor row already conforms to the identical contacts shape.
  return fields as unknown as WithoutSystemFields<Doc<'contacts'>>;
}

export const migration = defineDbMigration({
  title: 'Backfill contacts from vendors',
  description:
    'Copies every vendors row into the new contacts table, recording the ' +
    'origin in metadata.__migratedFrom. Idempotent; down removes the contacts ' +
    'materialized from vendors and leaves the vendors rows untouched.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['vendors', 'contacts'] },
  table: SOURCE_TABLE,

  async up(ctx, doc) {
    const organizationId = getStr(doc.organizationId);
    if (!organizationId) return;

    const sourceId = String(doc._id);
    const existing = await contactsForOrg(ctx, organizationId);
    const already = existing.some((c) => {
      const from = migratedFrom(c);
      return from?.table === SOURCE_TABLE && from?.id === sourceId;
    });
    if (already) return;

    await ctx.db.insert('contacts', toContactPayload(doc));
  },

  async down(ctx, doc) {
    const organizationId = getStr(doc.organizationId);
    if (!organizationId) return;

    const sourceId = String(doc._id);
    for (const c of await contactsForOrg(ctx, organizationId)) {
      const from = migratedFrom(c);
      if (from?.table === SOURCE_TABLE && from?.id === sourceId) {
        await ctx.db.delete(c._id);
      }
    }
  },
});
