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

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { DocumentItemResponse } from './types';

import { hasTeamAccess } from '../lib/team_access';
import { transformDocumentsBatch } from './transform_to_document_item';

interface FilterIndex {
  field: string;
  index: string;
}

const FILTER_INDEXES: FilterIndex[] = [
  { field: 'sourceProvider', index: 'by_organizationId_and_sourceProvider' },
  { field: 'extension', index: 'by_organizationId_and_extension' },
];

interface ListDocumentsPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
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
  primary: FilterIndex | undefined,
  filterArgs: FilterArgs,
) {
  if (primary) {
    const tableQuery = ctx.db.query('documents');
    const indexFn = (q: {
      eq: (
        field: string,
        value: string | undefined,
      ) => { eq: (field: string, value: string | undefined) => unknown };
    }) =>
      q
        .eq('organizationId', organizationId)
        .eq(primary.field, filterArgs[primary.field]);
    // @ts-expect-error -- dynamic index name; runtime correct, Convex types require literals
    return tableQuery.withIndex(primary.index, indexFn);
  }

  return ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
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

  const primary = FILTER_INDEXES.find(({ field }) => filterArgs[field]);
  let query = buildBaseQuery(
    ctx,
    args.organizationId,
    primary,
    filterArgs,
  ).order('desc');

  for (const { field } of FILTER_INDEXES) {
    if (filterArgs[field] && field !== primary?.field) {
      const value = filterArgs[field];
      // @ts-expect-error -- dynamic field name; runtime is correct, Convex types require literal field paths
      query = query.filter((q) => q.eq(q.field(field), value));
    }
  }

  const result = await query.paginate(args.paginationOpts);

  const userTeamSet = new Set(args.userTeamIds);
  const accessibleDocs = result.page.filter((doc: Doc<'documents'>) => {
    if (doc.teamId !== undefined) {
      return hasTeamAccess(doc, userTeamSet);
    }
    if (doc.teamTags && doc.teamTags.length > 0) {
      return doc.teamTags.some((tag) => userTeamSet.has(tag));
    }
    return true;
  });

  const transformedPage = await transformDocumentsBatch(ctx, accessibleDocs);

  return {
    page: transformedPage,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
