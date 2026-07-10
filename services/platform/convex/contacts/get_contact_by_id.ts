/**
 * Get a contact by ID (business logic)
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getContactById(ctx: QueryCtx, contactId: Id<'contacts'>) {
  return await ctx.db.get(contactId);
}
