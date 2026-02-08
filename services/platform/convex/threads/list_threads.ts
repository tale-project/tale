import type { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import type { Thread, ListThreadsArgs } from './types';

function isGeneralThread(summary?: string): boolean {
  if (!summary || !summary.includes('"general"')) return false;

  try {
    const parsed: unknown = JSON.parse(summary);
    return parsed !== null && typeof parsed === 'object' && 'chatType' in parsed && parsed.chatType === 'general';
  } catch {
    return false;
  }
}

export async function listThreads(
  ctx: QueryCtx,
  args: ListThreadsArgs,
): Promise<Thread[]> {
  const { userId, search } = args;
  const searchLower = search?.trim().toLowerCase();

  const result = await ctx.runQuery(
    components.agent.threads.listThreadsByUserId,
    {
      userId,
      order: 'desc',
      paginationOpts: { cursor: null, numItems: 100 },
    },
  );

  const threads: Thread[] = [];
  for (const thread of result.page) {
    // Cheapest check first: skip non-active threads before JSON parsing
    if (thread.status !== 'active') continue;
    if (!isGeneralThread(thread.summary)) continue;

    if (searchLower) {
      const title = thread.title?.toLowerCase() ?? '';
      if (!title.includes(searchLower)) continue;
    }

    threads.push({
      _id: thread._id,
      _creationTime: thread._creationTime,
      title: thread.title,
      status: thread.status,
      userId: thread.userId,
    });
  }

  return threads;
}
