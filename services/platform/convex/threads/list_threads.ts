import type { QueryCtx } from '../_generated/server';
import type { Thread, ListThreadsArgs } from './types';

import { components } from '../_generated/api';

function isGeneralThread(summary?: string): boolean {
  if (!summary || !summary.includes('"general"')) return false;

  try {
    const parsed: unknown = JSON.parse(summary);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      'chatType' in parsed &&
      parsed.chatType === 'general'
    );
  } catch {
    return false;
  }
}

export async function listThreads(
  ctx: QueryCtx,
  args: Pick<ListThreadsArgs, 'userId'>,
): Promise<Thread[]> {
  const result = await ctx.runQuery(
    components.agent.threads.listThreadsByUserId,
    {
      userId: args.userId,
      order: 'desc',
      paginationOpts: { cursor: null, numItems: 100 },
    },
  );

  const threads: Thread[] = [];
  for (const thread of result.page) {
    if (thread.status !== 'active') continue;
    if (!isGeneralThread(thread.summary)) continue;

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
