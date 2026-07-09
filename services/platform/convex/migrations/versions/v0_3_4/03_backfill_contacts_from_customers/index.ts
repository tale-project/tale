/**
 * DB migration: backfill `contacts` from `customers` (issue #2618).
 *
 * The runner paginates `customers`; `up` copies each row into `contacts`,
 * DROPPING the customer-only `status` field (contacts is status-less by
 * design), and stamps `metadata.__migratedFrom = { table: 'customers', id }`
 * for provenance and idempotency. `down` deletes the contacts materialized from
 * customers. Both are idempotent; the source `customers` rows (incl. status)
 * are never modified (so `down` needs no snapshot — it removes what `up`
 * inserted).
 */

import type { WithoutSystemFields } from 'convex/server';

import type { Doc } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

const SOURCE_TABLE = 'customers';

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
  // contacts is status-less by design — drop the customer-only `status` enum.
  delete fields.status;
  fields.metadata = {
    ...asRecord(doc.metadata),
    __migratedFrom: { table: SOURCE_TABLE, id: String(doc._id) },
  };
  // Minus `status`, the legacy customer row conforms to the contacts shape.
  return fields as unknown as WithoutSystemFields<Doc<'contacts'>>;
}

export const migration: DbMigration = {
  meta,
  table: SOURCE_TABLE,

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
