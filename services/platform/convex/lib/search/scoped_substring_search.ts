import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc, TableNames } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import {
  isActiveRow,
  type MatchMode,
  rowMatches,
  scoreAndSort,
} from './relevance';
import type { SearchStrategy } from './types';

export const MAX_SEARCH_PAGE_SIZE = 100;

/** Minimal structural shape of the index-range builder a caller may narrow
 *  with (e.g. add a status `.eq`). Convex's real type requires literal field
 *  paths, so callers pass a loosely-typed builder and the `withIndex` call
 *  below is `@ts-expect-error`-ed — the same pattern as `list_*_paginated`. */
export interface IndexRangeBuilder {
  eq: (field: string, value: unknown) => IndexRangeBuilder;
}

export interface EntitySearchArgs<T extends TableNames> {
  organizationId: string;
  /** Raw (un-trimmed) search term. */
  term: string;
  paginationOpts: PaginationOptions;
  /** Narrower index range than the default org scope (e.g. a status facet).
   *  Must still start from the org. Defaults to `eq('organizationId', …)`. */
  indexFilter?: (q: IndexRangeBuilder) => IndexRangeBuilder;
  /** Per-row visibility filter applied after the text match (e.g. team access). */
  accessFilter?: (row: Doc<T>) => boolean;
  /** How `term` is matched. Defaults to `'all'` — the right rule when a person
   *  typed the term. Pass `'any'` when `term` is a natural-language question
   *  rather than a name fragment; see {@link MatchMode}. */
  matchMode?: MatchMode;
}

/**
 * The NOW engine: paginate the org-scoped index, then post-filter the page by
 * substring match and relevance-order it page-locally. Never `.collect()`s the
 * whole table.
 *
 * Contract (mirrors `listPrompts`): when every row on a paginate slice fails
 * the text filter, `page` is empty while `isDone` is false — the client
 * (`useCachedPaginatedQuery`) auto-advances to the next slice.
 */
export async function scopedSubstringSearch<T extends TableNames>(
  ctx: QueryCtx,
  strategy: SearchStrategy<T>,
  args: EntitySearchArgs<T>,
): Promise<PaginationResult<Doc<T>>> {
  const rawTerm = args.term.trim();
  const lowerTerm = rawTerm.toLowerCase();
  const matchMode = args.matchMode ?? 'all';
  const numItems = Math.min(
    Math.max(args.paginationOpts.numItems, 1),
    MAX_SEARCH_PAGE_SIZE,
  );
  const paginationOpts = {
    cursor: args.paginationOpts.cursor ?? null,
    numItems,
  };

  const indexFilter =
    args.indexFilter ??
    ((q: IndexRangeBuilder) => q.eq('organizationId', args.organizationId));

  const result = await ctx.db
    .query(strategy.table)
    // @ts-expect-error -- dynamic index name + structural range builder; runtime
    // correct, Convex types require a literal index name + field paths.
    .withIndex(strategy.orgIndex, indexFilter)
    .order('desc')
    .paginate(paginationOpts);

  const page = result.page.filter((row) => {
    const record: Record<string, unknown> = row;
    if (strategy.activeOnly && !isActiveRow(record)) return false;
    if (args.accessFilter && !args.accessFilter(row)) return false;
    return rowMatches(row, strategy, lowerTerm, rawTerm, matchMode);
  });

  return {
    ...result,
    page: scoreAndSort(page, strategy, lowerTerm, matchMode),
  };
}
