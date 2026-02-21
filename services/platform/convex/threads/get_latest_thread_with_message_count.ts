import { listUIMessages } from '@convex-dev/agent';

import type { QueryCtx } from '../_generated/server';

import { components } from '../_generated/api';

export async function getLatestThreadWithMessageCount(
  ctx: QueryCtx,
  userId: string,
): Promise<{ threadId: string; messageCount: number } | null> {
  const latestMetadata = await ctx.db
    .query('threadMetadata')
    .withIndex('by_userId_chatType_status', (q) =>
      q.eq('userId', userId).eq('chatType', 'general').eq('status', 'active'),
    )
    .order('desc')
    .first();

  if (!latestMetadata) return null;

  const messagesResult = await listUIMessages(ctx, components.agent, {
    threadId: latestMetadata.threadId,
    paginationOpts: { cursor: null, numItems: 1 },
  });

  return {
    threadId: latestMetadata.threadId,
    messageCount: messagesResult.page.length,
  };
}
