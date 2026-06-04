/**
 * Batch-fetch customers by id, de-duplicated.
 *
 * Avoids the per-conversation `ctx.db.get(customerId)` N+1 when transforming a
 * page of conversations: a page of 25 sharing a few customers collapses to one
 * deduped fan-out instead of 25 sequential point reads. Customers live in the
 * app's own `customers` table, so these are native indexed reads.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getCustomersByIds(
  ctx: QueryCtx,
  ids: Array<Id<'customers'>>,
): Promise<Map<Id<'customers'>, Doc<'customers'>>> {
  const result = new Map<Id<'customers'>, Doc<'customers'>>();
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
