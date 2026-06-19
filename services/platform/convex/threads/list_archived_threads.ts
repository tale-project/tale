import type { PaginationOptions } from 'convex/server';

import type { QueryCtx } from '../_generated/server';
import { excludeDiscussionThreads } from './list_threads';
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
    organizationId?: string;
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
      // Exclude discussions but KEEP fork branches: an archived branch still
      // belongs in the archived chat-history list (unlike the active list and
      // command palette, which also hide branches).
      const baseExclusions = excludeDiscussionThreads(q);
      // Filter by organizationId to prevent cross-tenant thread visibility.
      if (args.teamId && args.organizationId) {
        return q.and(
          baseExclusions,
          q.eq(q.field('teamId'), args.teamId),
          q.eq(q.field('organizationId'), args.organizationId),
        );
      }
      if (args.organizationId) {
        return q.and(
          baseExclusions,
          q.eq(q.field('organizationId'), args.organizationId),
        );
      }
      if (args.teamId) {
        return q.and(baseExclusions, q.eq(q.field('teamId'), args.teamId));
      }
      return baseExclusions;
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
