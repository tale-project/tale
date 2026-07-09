/**
 * Batch-fetch contacts by id, de-duplicated.
 *
 * Avoids the per-conversation `ctx.db.get(contactId)` N+1 when transforming a
 * page of conversations: a page of 25 sharing a few contacts collapses to one
 * deduped fan-out instead of 25 sequential point reads. Contacts live in the
 * app's own `contacts` table, so these are native indexed reads.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getContactsByIds(
  ctx: QueryCtx,
  ids: Array<Id<'contacts'>>,
): Promise<Map<Id<'contacts'>, Doc<'contacts'>>> {
  const result = new Map<Id<'contacts'>, Doc<'contacts'>>();
  const uniqueIds = [...new Set(ids)];
  await Promise.all(
    uniqueIds.map(async (id) => {
      const doc = await ctx.db.get(id);
      if (doc) {
        result.set(id, doc);
      }
    }),
  );
  return result;
}
