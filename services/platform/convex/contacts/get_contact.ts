/**
 * Get a single contact by ID (business logic)
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getContact(
  ctx: QueryCtx,
  contactId: Id<'contacts'>,
): Promise<Doc<'contacts'> | null> {
  return await ctx.db.get(contactId);
}
