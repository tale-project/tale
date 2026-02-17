import type { PaginationOptions } from 'convex/server';

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

interface ListThreadsPaginatedResult {
  page: Thread[];
  isDone: boolean;
  continueCursor: string;
}

const MAX_AGENT_PAGES = 5;

export async function listThreads(
  ctx: QueryCtx,
  args: Pick<ListThreadsArgs, 'userId'> & {
    paginationOpts: PaginationOptions;
  },
): Promise<ListThreadsPaginatedResult> {
  const threads: Thread[] = [];
  let cursor = args.paginationOpts.cursor;
  const limit = args.paginationOpts.numItems;
  let isDone = false;

  // Fetch agent pages until we have enough matching general threads.
  // Non-general/inactive threads are filtered out, so we may need
  // multiple agent pages to fill a single frontend page.
  for (let i = 0; i < MAX_AGENT_PAGES && threads.length < limit; i++) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex pagination cursor type
    const paginationOpts = { cursor, numItems: Math.max(limit, 50) } as {
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

    if (result.isDone) {
      isDone = true;
      break;
    }
    cursor = result.continueCursor;
  }

  return {
    page: threads.slice(0, limit),
    isDone,
    continueCursor: cursor ?? '',
  };
}
