/**
 * List documents using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Dispatches to the best 2-field compound index based on the primary active
 * filter, then applies .filter() for any remaining filters.
 *
 * After pagination, applies team-based access control and transforms documents
 * to DocumentItemResponse format.
 */

import type { PaginationOptions } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { DocumentItemResponse } from './types';

import { hasTeamAccess } from '../lib/team_access';
import { transformDocumentsBatch } from './transform_to_document_item';

interface FilterIndex {
  field: string;
  index: string;
}

const SECONDARY_FILTER_INDEXES: FilterIndex[] = [
  { field: 'sourceProvider', index: 'by_organizationId_and_sourceProvider' },
  { field: 'extension', index: 'by_organizationId_and_extension' },
];

interface ListDocumentsPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  folderId?: Id<'folders'>;
  sourceProvider?: string;
  extension?: string;
  userTeamIds: string[];
}

interface PaginatedDocumentResult {
  page: DocumentItemResponse[];
  isDone: boolean;
  continueCursor: string;
}

type FilterArgs = Record<string, string | undefined>;

function buildBaseQuery(
  ctx: QueryCtx,
  organizationId: string,
  folderId: Id<'folders'> | undefined,
) {
  return ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    );
}

export async function listDocumentsPaginated(
  ctx: QueryCtx,
  args: ListDocumentsPaginatedArgs,
): Promise<PaginatedDocumentResult> {
  const filterArgs: FilterArgs = {
    sourceProvider: args.sourceProvider,
    extension: args.extension,
  };

  let query = buildBaseQuery(ctx, args.organizationId, args.folderId).order(
    'desc',
  );

  for (const { field } of SECONDARY_FILTER_INDEXES) {
    if (filterArgs[field]) {
      const value = filterArgs[field];
      // @ts-expect-error -- dynamic field name; runtime is correct, Convex types require literal field paths
      query = query.filter((q) => q.eq(q.field(field), value));
    }
  }

  const result = await query.paginate(args.paginationOpts);

  const userTeamSet = new Set(args.userTeamIds);
  const accessibleDocs = result.page.filter((doc: Doc<'documents'>) =>
    hasTeamAccess(doc, userTeamSet),
  );

  const transformedPage = await transformDocumentsBatch(ctx, accessibleDocs);

  return {
    page: transformedPage,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
