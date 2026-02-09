import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import {
  paginateWithFilter,
  type CursorPaginatedResult,
} from '../lib/pagination';

export interface QueryDocumentsArgs {
  organizationId: string;
  sourceProvider?: 'onedrive' | 'upload' | 'sharepoint';
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

function buildQuery(ctx: QueryCtx, args: QueryDocumentsArgs) {
  if (args.sourceProvider !== undefined) {
    return ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_sourceProvider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('sourceProvider', args.sourceProvider),
      );
  }

  return ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );
}

export async function queryDocuments(
  ctx: QueryCtx,
  args: QueryDocumentsArgs,
): Promise<CursorPaginatedResult<Doc<'documents'>>> {
  return paginateWithFilter(buildQuery(ctx, args).order('desc'), {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
  });
}
