/**
 * Server-side FILTERED pagination — the heart of "page 1 is a full page of
 * visible rows". A list whose rows are filtered AFTER the fetch (drop pull
 * requests, drop issues already tracked as tasks) can't be paged by raw source
 * pages: a whole source page can filter to empty even when later pages have
 * matches. This walks the source page-by-page and keeps pulling until it has
 * filled `perPage` VISIBLE rows (or the source / the per-call budget is spent),
 * returning the visible rows plus an opaque cursor to resume from.
 *
 * The only bounds are real ones: the page is full, the source is exhausted
 * (`hasNext` false ⇒ `nextCursor: null`), or the per-call resource budget
 * (`pageBudget`) is hit — in which case it returns what it has plus a cursor, so
 * the result is always a correct PREFIX of the filtered stream and never
 * dead-ends. There is no probabilistic page-count cap.
 *
 * I/O is injected (`fetchSourcePage`) so this is a pure, exhaustively-testable
 * function; the Convex action supplies the real upstream fetch + exclusion set.
 */
import { interpolateTemplate } from '../utils/interpolate';
import { evaluateWhen } from './when_predicate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One raw source page: its rows and whether the source has a page after it. */
export interface SourcePage {
  rows: unknown[];
  hasNext: boolean;
}

/** Resume point: 1-indexed source page + index of the first un-emitted row. */
interface PageCursor {
  sourcePage: number;
  sourceOffset: number;
}

interface FilteredPage {
  data: Record<string, unknown>[];
  pagination: { hasNextPage: boolean; nextCursor: PageCursor | null };
}

export async function collectFilteredPage(opts: {
  /** Fetch one 1-indexed source page. */
  fetchSourcePage: (page: number) => Promise<SourcePage>;
  /** Keys already materialized elsewhere — rows whose key is here are dropped. */
  excluded: Set<string>;
  /** `{field}` template rebuilding a row's exclusion key. */
  rowKeyTemplate: string;
  /** Values merged UNDER each row when interpolating the key (e.g. a configured
   *  `owner`/`repo` the row itself doesn't carry); row fields win a name clash.
   *  Must match what the materialize/create path wrote the key from. */
  templateScope?: Record<string, unknown>;
  /** Optional `when_predicate` row filter (e.g. `!pull_request`). */
  rowWhen?: string;
  /** Target page size in VISIBLE (post-filter) rows. */
  perPage: number;
  /** Where to resume; absent ⇒ start at the source's first page. */
  cursor?: PageCursor;
  /** Max source pages to scan in one call before yielding a cursor. */
  pageBudget: number;
}): Promise<FilteredPage> {
  const {
    fetchSourcePage,
    excluded,
    rowKeyTemplate,
    templateScope,
    rowWhen,
    perPage,
    cursor,
    pageBudget,
  } = opts;

  const visible: Record<string, unknown>[] = [];
  let sourcePage = cursor?.sourcePage ?? 1;
  let sourceOffset = cursor?.sourceOffset ?? 0;
  let pagesScanned = 0;

  const done = (nextCursor: PageCursor | null): FilteredPage => ({
    data: visible,
    pagination: { hasNextPage: nextCursor !== null, nextCursor },
  });

  for (;;) {
    const { rows, hasNext } = await fetchSourcePage(sourcePage);

    for (let i = sourceOffset; i < rows.length; i++) {
      const row = rows[i];
      if (!isRecord(row)) continue;
      if (rowWhen && !evaluateWhen(rowWhen, row)) continue;
      const key = interpolateTemplate(rowKeyTemplate, {
        ...templateScope,
        ...row,
      });
      if (excluded.has(key)) continue;
      visible.push(row);
      if (visible.length >= perPage) {
        // Page filled mid-source-page — resume from the next row next time.
        return done({ sourcePage, sourceOffset: i + 1 });
      }
    }

    sourcePage += 1;
    sourceOffset = 0;
    pagesScanned += 1;

    if (!hasNext) return done(null); // true end of the source
    if (pagesScanned >= pageBudget)
      return done({ sourcePage, sourceOffset: 0 });
  }
}
