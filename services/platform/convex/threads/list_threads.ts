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
    teamId?: string;
    organizationId?: string;
  },
): Promise<ListThreadsPaginatedResult> {
  const result = await ctx.db
    .query('threadMetadata')
    .withIndex('by_userId_chatType_status_updated', (q) =>
      q
        .eq('userId', args.userId)
        .eq('chatType', 'general')
        .eq('status', 'active'),
    )
    .filter((q) => {
      // Filter by organizationId so users who belong to multiple orgs don't
      // see threads created in other tenants. threadMetadata.organizationId
      // is optional for backward-compat with pre-multi-org rows.
      let expr = q.neq(q.field('isBranch'), true);
      if (args.teamId) {
        expr = q.and(expr, q.eq(q.field('teamId'), args.teamId));
      }
      if (args.organizationId) {
        expr = q.and(
          expr,
          q.eq(q.field('organizationId'), args.organizationId),
        );
      }
      return expr;
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
      isShared: row.isShared ?? false,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
