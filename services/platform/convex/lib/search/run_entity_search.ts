import type { PaginationResult } from '../ctx';
import type { QueryCtx } from '../ctx';
import type { Doc, TableNames } from '../rows';
import {
  type EntitySearchArgs,
  scopedSubstringSearch,
} from './scoped_substring_search';
import type { SearchStrategy } from './types';

/**
 * The single dispatch point for backend entity search — **the seam**. Call
 * sites only ever call this; they never branch on the engine. Today every
 * strategy resolves to the scan engine. When the self-hosted Convex
 * `SearchIndexBootstrapWorker` is fixed, implement `runSearchIndexEngine` and
 * flip a strategy's `engine` to `'searchIndex'` (plus `searchIndexName`) — that
 * is the entire migration for that entity, with no call-site changes.
 */
export async function runEntitySearch<T extends TableNames>(
  ctx: QueryCtx,
  strategy: SearchStrategy<T>,
  args: EntitySearchArgs<T>,
): Promise<PaginationResult<Doc<T>>> {
  if (strategy.engine === 'searchIndex') {
    // The discriminated `SearchStrategy` guarantees `searchIndexName`/
    // `searchIndexField` here, so a misconfigured strategy can't silently reach
    // this branch. FUTURE: route through `.withSearchIndex(strategy.searchIndexName, …)`.
    // Single edit point — intentionally not implemented while the bootstrap
    // is disabled. Fall through to the scan engine until then.
    console.warn(
      `[search] searchIndex engine requested for "${strategy.table}" but not ` +
        `yet implemented; falling back to scan.`,
    );
  }
  return scopedSubstringSearch(ctx, strategy, args);
}
