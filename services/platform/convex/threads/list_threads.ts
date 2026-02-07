import { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import type { Thread, ListThreadsArgs } from './types';

function isGeneralThread(summary?: string): boolean {
  if (!summary) return false;

  try {
    const parsed: unknown = JSON.parse(summary);

    if (parsed && typeof parsed === 'object' && 'chatType' in parsed) {
      return parsed.chatType === 'general';
    }

    return false;
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

  const filtered = result.page.filter((thread) => {
    if (thread.status !== 'active' || !isGeneralThread(thread.summary)) {
      return false;
    }

    if (searchLower) {
      const title = thread.title?.toLowerCase() ?? '';
      return title.includes(searchLower);
    }

    return true;
  });

  return filtered.map((thread) => ({
    _id: thread._id,
    _creationTime: thread._creationTime,
    title: thread.title,
    status: thread.status,
    userId: thread.userId,
  }));
}
