import type { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { listUIMessages } from '@convex-dev/agent';

export async function getLatestThreadWithMessageCount(
  ctx: QueryCtx,
  userId: string,
): Promise<{ threadId: string; messageCount: number } | null> {
  const result = await ctx.runQuery(
    components.agent.threads.listThreadsByUserId,
    {
      userId,
      order: 'desc',
      paginationOpts: { cursor: null, numItems: 1 },
    },
  );

  const latestThread = result.page.find((thread) => thread.status === 'active');
  if (!latestThread) return null;

  const messagesResult = await listUIMessages(ctx, components.agent, {
    threadId: latestThread._id,
    paginationOpts: { cursor: null, numItems: 1 },
  });

  return {
    threadId: latestThread._id,
    messageCount: messagesResult.page.length,
  };
}

