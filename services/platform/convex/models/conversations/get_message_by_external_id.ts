/**
 * Get a message by its external message ID within an organization
 */

import type { QueryCtx } from '../../_generated/server';

export async function getMessageByExternalId(
  ctx: QueryCtx,
  organizationId: string,
  externalMessageId: string,
) {
  const msg = await ctx.db
    .query('conversationMessages')
    .withIndex('by_organizationId_and_externalMessageId', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('externalMessageId', externalMessageId),
    )
    .first();

  return msg ?? null;
}
