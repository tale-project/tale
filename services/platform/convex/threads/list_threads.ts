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
  const threads: Thread[] = [];
  let cursor: string | null = null;

  // Paginate through all pages to collect every general thread.
  // Sub-threads consume pagination slots but are filtered out, so a
  // single page of 100 can miss general threads for active users.
  for (;;) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex pagination cursor type
    const paginationOpts = { cursor, numItems: 100 } as {
      cursor: string | null;
      numItems: number;
    };
    const result = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      {
        userId: args.userId,
        order: 'desc',
        paginationOpts,
      },
    );

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

    if (result.isDone) break;
    cursor = result.continueCursor;
  }

  return threads;
}
