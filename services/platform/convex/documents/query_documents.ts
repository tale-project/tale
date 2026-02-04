/**
 * Query documents with cursor-based pagination and filtering
 *
 * Uses Convex's native .paginate() for optimal performance.
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import type { CursorPaginatedResult } from '../lib/pagination';

export interface QueryDocumentsArgs {
  organizationId: string;
  sourceProvider?: 'onedrive' | 'upload' | 'sharepoint';
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export async function queryDocuments(
  ctx: QueryCtx,
  args: QueryDocumentsArgs,
): Promise<CursorPaginatedResult<Doc<'documents'>>> {
  // Select index based on available filters
  let query = ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );

  if (args.sourceProvider !== undefined) {
    query = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_sourceProvider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('sourceProvider', args.sourceProvider),
      );
  }

  const result = await query.paginate(args.paginationOpts);

  return {
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
