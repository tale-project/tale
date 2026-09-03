import { fetchJson } from '../../../lib/utils/type-utils';

/**
 * One Graph collection read, followed to the end. Graph answers `/children`
 * and `/search` in pages (≤200 items) chained by an absolute
 * `@odata.nextLink`; a reader that takes only the first page shows a folder
 * of 300 files as 100 and calls it complete. Every browse/import lister
 * pages through here, up to a bound, and says `truncated` when the bound
 * cut the walk — never a silent short read.
 */

/** The most items one browse/import listing collects before it stops and
 * says so — ~50 Graph pages, far past any folder a picker can render. */
export const GRAPH_LIST_MAX_ITEMS = 10_000;

/** Fail-safe on the page walk (a nextLink cycle); at ≥1 item per page the
 * item bound trips first, so hitting this means Graph is misbehaving. */
const MAX_PAGES = 500;

interface GraphPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

export type GraphCollectionResult<T> =
  | { ok: true; items: T[]; truncated: boolean }
  | { ok: false; status: number; errorText: string };

export async function fetchGraphCollection<T>(args: {
  url: string;
  token: string;
  maxItems: number;
}): Promise<GraphCollectionResult<T>> {
  const items: T[] = [];
  let url: string | undefined = args.url;
  for (let page = 0; url !== undefined; page++) {
    if (page >= MAX_PAGES) {
      return { ok: true, items, truncated: true };
    }
    const response: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        errorText: await response.text(),
      };
    }
    const body: GraphPage<T> = await fetchJson<GraphPage<T>>(response);
    items.push(...body.value);
    url = body['@odata.nextLink'];
    if (items.length >= args.maxItems) {
      // Past the bound: keep exactly the bound and say the folder holds
      // more — whether another page waits, or this one overflowed it.
      const truncated = url !== undefined || items.length > args.maxItems;
      return { ok: true, items: items.slice(0, args.maxItems), truncated };
    }
  }
  return { ok: true, items, truncated: false };
}
