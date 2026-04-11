import type { PaginationOptions } from 'convex/server';

import type { QueryCtx } from '../_generated/server';
import type { Thread } from './types';

interface ListArchivedThreadsPaginatedResult {
  page: Thread[];
  isDone: boolean;
  continueCursor: string;
}

export async function listArchivedThreads(
  ctx: QueryCtx,
  args: {
    userId: string;
    paginationOpts: PaginationOptions;
    teamId?: string;
  },
): Promise<ListArchivedThreadsPaginatedResult> {
  const result = await ctx.db
    .query('threadMetadata')
    .withIndex('by_userId_chatType_status_updated', (q) =>
      q
        .eq('userId', args.userId)
        .eq('chatType', 'general')
        .eq('status', 'archived'),
    )
    .filter((q) => {
      if (!args.teamId) return true;
      return q.eq(q.field('teamId'), args.teamId);
    })
    .order('desc')
    .paginate(args.paginationOpts);

  return {
    page: result.page.map((row) => ({
      _id: row.threadId,
      _creationTime: row.updatedAt ?? row.createdAt,
      title: row.title,
      status: row.status,
      userId: row.userId,
      generationStatus: row.generationStatus,
      teamId: row.teamId,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
