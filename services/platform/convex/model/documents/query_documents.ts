/**
 * Query documents with pagination and filtering
 */

import type { QueryCtx } from '../../_generated/server';
import type { QueryDocumentsArgs, QueryDocumentsResult } from './types';

export async function queryDocuments(
  ctx: QueryCtx,
  args: QueryDocumentsArgs,
): Promise<QueryDocumentsResult> {
  // Start with organizationId index
  let query = ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );

  // If sourceProvider is specified, use the more specific index
  if (args.sourceProvider !== undefined) {
    query = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_sourceProvider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('sourceProvider', args.sourceProvider),
      );
  }

  // Collect results with pagination
  const result = await query.paginate(args.paginationOpts);

  return {
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
    count: result.page.length,
  };
}
