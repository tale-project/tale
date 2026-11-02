import { queryOfAddress } from '@/app/lib/query-param';

/** The view as the address of the page holds it: `/proxies?q=198.51`. */
interface ProxiesSearch {
  /** What is typed in the search box. */
  q?: string | undefined;
}

/**
 * The `validateSearch` of the Proxies route. A search that makes no sense comes
 * back as `undefined`, not left out: the router lays what a route returns over
 * what the address says, so a part left out would keep its raw value.
 */
export function validateProxiesSearch(
  search: Record<string, unknown>,
): ProxiesSearch {
  return { q: queryOfAddress(search.q) };
}
