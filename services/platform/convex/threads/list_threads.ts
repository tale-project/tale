import type { PaginationOptions } from 'convex/server';

import type { QueryCtx } from '../_generated/server';
import type { Thread, ListThreadsArgs } from './types';

export function isGeneralThread(summary?: string): boolean {
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

export async function listThreads(
  ctx: QueryCtx,
  args: Pick<ListThreadsArgs, 'userId'> & {
    paginationOpts: PaginationOptions;
  },
): Promise<ListThreadsPaginatedResult> {
  const result = await ctx.db
    .query('threadMetadata')
    .withIndex('by_userId_chatType_status', (q) =>
      q
        .eq('userId', args.userId)
        .eq('chatType', 'general')
        .eq('status', 'active'),
    )
    .order('desc')
    .paginate(args.paginationOpts);

  return {
    page: result.page.map((row) => ({
      _id: row.threadId,
      _creationTime: row.createdAt,
      title: row.title,
      status: row.status,
      userId: row.userId,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
