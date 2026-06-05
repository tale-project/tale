/**
 * Bounded, paged hard-delete for pure-DB (no `_storage`) rows.
 *
 * An unbounded `.collect()` + `Promise.all(delete)` over a growing, org-scoped
 * table throws mid-transaction once it crosses Convex's read/write budget,
 * which for an erasure cascade means a *partially* erased org (a GDPR Art 17
 * gap). This pages the delete and reports whether it stopped early so the
 * caller can drain the remainder across further transactions.
 *
 * Storage-bearing tables (TTS chunks, video-link jobs) keep their own inline
 * loops because each row also owns a `_storage` blob that must be deleted
 * alongside it (with the delete-ordering the existing cascade helpers
 * document); this helper is only for plain row deletion.
 */

import type { TableNamesInDataModel } from 'convex/server';
import type { GenericId } from 'convex/values';

import type { DataModel } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

// `ctx.db.delete` accepts an id for any table in the data model, so the page
// rows only need to expose `_id`; a concrete `Doc<T>[]` is assignable here.
type AnyDocId = GenericId<TableNamesInDataModel<DataModel>>;

export const DEFAULT_PAGE_SIZE = 200;
// 30 × 200 = 6000 rows/pass, comfortably under the ~8k per-mutation write
// budget while leaving headroom for the caller's other work.
export const DEFAULT_MAX_PAGES = 30;

/**
 * Delete rows page-by-page using a caller-supplied `take(n)` thunk that returns
 * the next page from a fresh indexed query (deleted rows drop out, so re-running
 * the same range advances). Returns the count deleted and whether the page cap
 * was hit with a still-full page (i.e. more rows likely remain → drain again).
 */
export async function pagedHardDelete(
  ctx: MutationCtx,
  takePage: (pageSize: number) => Promise<ReadonlyArray<{ _id: AnyDocId }>>,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<{ deleted: number; exhausted: boolean }> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  let deleted = 0;
  for (let page = 0; page < maxPages; page++) {
    const rows = await takePage(pageSize);
    if (rows.length === 0) {
      return { deleted, exhausted: false };
    }
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    if (rows.length < pageSize) {
      return { deleted, exhausted: false };
    }
  }
  // Ran the full page budget and the last page was still full → assume more.
  return { deleted, exhausted: true };
}
