/**
 * Get a contact by email within an organization (business logic)
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getContactByEmail(
  ctx: QueryCtx,
  organizationId: string,
  email: string,
): Promise<Doc<'contacts'> | null> {
  return await ctx.db
    .query('contacts')
    .withIndex('by_organizationId_and_email', (q) =>
      q.eq('organizationId', organizationId).eq('email', email),
    )
    .first();
}
